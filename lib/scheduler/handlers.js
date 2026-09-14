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

export const JOB_HANDLERS = {
  create_general_request: handleCreateGeneralRequest,
};

export const JOB_TYPES = Object.keys(JOB_HANDLERS);
