import { createGeneralRequest } from '../requests-general/createGeneralRequest.js';
import { notifyNewRequest } from '../notificationEvents.js';
import { syncRequestToSapsend } from '../sapsend/treasury.js';

/**
 * Registro de handlers del servicio central de tareas automáticas.
 *
 * Cada job de scheduled_job trae un job_type que se despacha contra este objeto.
 * Un handler recibe el payload (JSON del job ya parseado) y devuelve
 * `{ ref?: string, detail?: string }` para el log (scheduled_job_run); si lanza,
 * el runner registra el job como 'error' y sigue con el resto.
 *
 * Agregar una automatización nueva = escribir una función + una entrada aquí
 * (ej. futuros: help-desk, articles, reportes...).
 */

/**
 * job_type 'create_general_request': crea una Solicitud General completa.
 * Payload esperado: { company, process, subject, descripcion, created_by? }.
 * El solicitante es el usuario "sistema" (env SCHEDULER_SYSTEM_USER_ID) con
 * fallback al created_by guardado en el payload/job.
 */
async function handleCreateGeneralRequest(payload) {
  const { company, process: processId, subject, descripcion } = payload || {};

  if (!company || !processId || !subject || !descripcion) {
    throw new Error(
      'Payload incompleto: se requieren company, process, subject y descripcion'
    );
  }

  const createdby =
    process.env.SCHEDULER_SYSTEM_USER_ID || payload.created_by || null;
  if (!createdby) {
    throw new Error(
      'Sin solicitante: configure SCHEDULER_SYSTEM_USER_ID o created_by en el payload'
    );
  }

  const { id_request, processEmail, taskEmails } = await createGeneralRequest({
    company,
    subject,
    descripcion,
    process: processId,
    createdby,
    url: null,
    formValues: [],
  });

  // Mismos efectos secundarios que create-request/route.js, pero awaited (estamos en un
  // job de fondo, no en un request HTTP) y sin tumbar el job si fallan.
  try {
    await notifyNewRequest({
      requestId: id_request,
      subject,
      processEmail,
      taskEmails,
      requestUrl: null,
    });
  } catch (err) {
    console.error(`[scheduler] notifyNewRequest falló para solicitud #${id_request}:`, err);
  }

  try {
    await syncRequestToSapsend(id_request);
  } catch (err) {
    console.error(`[scheduler] syncRequestToSapsend falló para solicitud #${id_request}:`, err);
  }

  return { ref: String(id_request), detail: `Solicitud #${id_request} creada` };
}

/**
 * job_type 'sgc_review_alerts': avisos anticipados de vencimiento y
 * recordatorios de lectura del SGC documental (módulo aislado). Se importa
 * en diferido para no cargar el SGC en cada corrida del programador.
 * Payload opcional: { company } para correr una sola empresa.
 */
async function handleSgcReviewAlerts(payload) {
  const { runSgcScheduledJob } = await import('../sgc/alerts/job');
  return runSgcScheduledJob(payload);
}

/**
 * job_type 'correo_sincronizar_hilos': módulo Correo — pasa a notas de cada caso los
 * correos nuevos de los hilos vinculados. APAGADO salvo CORREO_SYNC_HABILITADO=true.
 */
async function handleCorreoSincronizarHilos(payload) {
  const { runCorreoSyncJob } = await import('../correo/job');
  return runCorreoSyncJob(payload);
}

/**
 * job_type 'vitrina_sincronizar_sap': Vitrina Comercial — lectura nocturna del SAP de cada
 * empresa del piloto (SOLO LECTURA). Payload opcional: { companies: [1, 2] }.
 */
async function handleVitrinaSincronizarSap(payload) {
  const { runVitrinaSyncJob } = await import('../vitrina/job');
  return runVitrinaSyncJob(payload);
}

/**
 * job_type 'nabuco_transferir': Transferencias Nabuco — envía a Nabuco WMS los documentos
 * de SAP de UNA configuración. Payload: { id_config }. La tarea la crea la pantalla del módulo.
 */
async function handleNabucoTransferir(payload) {
  const { runNabucoTransferirJob } = await import('../transferencias-nabuco/job');
  return runNabucoTransferirJob(payload);
}

/** job_type 'nabuco_vigilar': Transferencias Nabuco — alerta si una configuración activa no corre en N minutos. */
async function handleNabucoVigilar() {
  const { runNabucoVigilarJob } = await import('../transferencias-nabuco/job');
  return runNabucoVigilarJob();
}

export const JOB_HANDLERS = {
  create_general_request: handleCreateGeneralRequest,
  sgc_review_alerts: handleSgcReviewAlerts,
  correo_sincronizar_hilos: handleCorreoSincronizarHilos,
  vitrina_sincronizar_sap: handleVitrinaSincronizarSap,
  nabuco_transferir: handleNabucoTransferir,
  nabuco_vigilar: handleNabucoVigilar,
};

export const JOB_TYPES = Object.keys(JOB_HANDLERS);
