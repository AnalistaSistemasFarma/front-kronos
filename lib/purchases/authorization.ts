import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { prisma } from '../prisma';
import { fireAndForgetNotification, notifyNewRequest } from '../notificationEvents';
import { createAndSendNotifications } from '../notifications.js';
import { createGeneralRequest } from '../requests-general/createGeneralRequest';
import { sapGet, sapLogin, sapLogout, sapPatch, SapError, type SapSession } from '../sap/serviceLayer';
import { publishApprovedDraft, publishSap } from './publish';
import { startStep, finishStep, withStep, type TriggeredBy } from '../workflow-sap/executionLog';
import { isAuthorizationEffectEnabled } from '../workflow-sap/config';
import { checkTransition, normalizeState } from './states';

/**
 * Integracion de Compras con el modulo de Autorizaciones de SynerLink.
 *
 *  ENVIAR (B -> LA, o ENC -> LA): se crea una solicitud del workflow
 *  (requests_general) con la plantilla de la empresa (purchase_company_config),
 *  cuya tarea de autorizacion resuelve el pool por departamento. Se guarda el
 *  enlace en purchase_authorization y se pasa el borrador a LA.
 *
 *  DECIDIR: update-activities llama onAuthorizationDecision al autorizar (2) o
 *  rechazar (3) una tarea de autorizacion. Si la solicitud es de compras:
 *    - autorizada -> se publica la firme (publish.ts) y el borrador queda en A.
 *    - rechazada  -> el borrador pasa a NAD con el motivo.
 *  Ya no se decide en el boton de SAPSEND: la autorizacion vive en SynerLink.
 */

/**
 * notificationEvents.js no tiene tipos: TS infiere sus parametros de los valores
 * por defecto (`= []`, `= null`) y los deja demasiado estrechos. Firma real:
 */
const notifyNewRequestTyped = notifyNewRequest as unknown as (args: {
  requestId: number;
  subject: string;
  processEmail: string | null;
  processEmails: string[];
  taskEmails: string[];
  creatorEmail: string | null;
  requestUrl?: string;
}) => Promise<unknown>;

const createAndSendNotificationsTyped = createAndSendNotifications as unknown as (
  emails: string[],
  payload: { title: string; body: string; url?: string; tag?: string }
) => Promise<unknown>;

/** Tras una decision del autorizador, corre las Tareas SAP del flujo (no bloquea). */
function afterDecision(idRequest: number, source: 'decision' | 'executor') {
  if (source !== 'decision') return; // el motor ya esta corriendo
  fireAndForgetNotification(import('../workflow-sap/engine').then((m) => m.runSapExecutors(idRequest)));
}

/** Autorizacion viva: impide otro envio del mismo borrador. */
const ACTIVE = ['pending', 'publishing', 'publish_error'];

/** Conexion SAP de la empresa para acciones del sistema (no dependen del permiso del usuario). */
export async function companySap(companyId: number): Promise<SapSession> {
  const company = await prisma.company.findUnique({
    where: { id_company: companyId },
    include: { sap_endpoints: true },
  });
  const ep = company?.sap_endpoints.find((e) => e.is_active) ?? company?.sap_endpoints[0];
  if (!ep?.base_url || !ep.client) throw new Error(`La empresa ${companyId} no tiene conexion SAP configurada.`);
  return sapLogin({ baseUrl: ep.base_url, username: ep.username ?? '', password: ep.password ?? '', companyDB: ep.client });
}

/** Cancela la solicitud del workflow (y sus tareas) cuando no se pudo completar el envio. */
async function cancelGeneralRequest(idRequest: number): Promise<void> {
  const pool = await sql.connect(sqlConfig);
  await pool
    .request()
    .input('id', sql.Int, idRequest)
    .query(`UPDATE requests_general SET status_req = 3 WHERE id = @id;
            UPDATE task_request_general SET id_status = 3 WHERE id_request_general = @id AND id_status = 4;`);
}

export type SendResult =
  | { ok: true; idRequestGeneral: number; state: 'LA' }
  | { ok: false; status: number; error: string };

/** Envia un borrador a autorizar. `sap` es la sesion abierta con el permiso del usuario. */
export async function sendToAuthorize(params: {
  sap: SapSession;
  companyId: number;
  docEntry: number;
  userEmail: string;
  /** Asunto escrito en «Mis solicitudes» (opcional): se antepone al de la solicitud del workflow. */
  subject?: string | null;
}): Promise<SendResult> {
  const { sap, companyId, docEntry, userEmail } = params;

  const draft = await sapGet<Record<string, unknown>>(
    sap,
    `Drafts(${docEntry})?$select=DocEntry,DocObjectCode,U_SEND_State,Comments,DocTotal,DocCurrency,U_SEND_UserName`
  );
  if (draft.DocObjectCode !== 'oPurchaseRequest') {
    return { ok: false, status: 404, error: 'El documento no es una solicitud de compra.' };
  }
  const state = normalizeState(draft.U_SEND_State);
  const check = checkTransition(state, state === 'ENC' ? 'reenviar' : 'enviar');
  if (!check.ok) return { ok: false, status: 409, error: check.error };

  const active = await prisma.purchaseAuthorization.findFirst({
    where: { id_company: companyId, doc_entry: docEntry, status: { in: ACTIVE } },
  });
  if (active) return { ok: false, status: 409, error: 'La solicitud ya tiene una autorizacion en curso.' };

  const config = await prisma.purchaseCompanyConfig.findUnique({ where: { id_company: companyId } });
  if (!config) {
    return { ok: false, status: 422, error: 'La empresa no tiene configurado el proceso de autorizacion de compras.' };
  }
  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (!user) return { ok: false, status: 401, error: 'Usuario no encontrado.' };

  const total = draft.DocTotal != null ? ` · Total ${Number(draft.DocTotal).toLocaleString('es-CO')} ${draft.DocCurrency ?? ''}` : '';
  const userSubject = (params.subject ?? '').trim().slice(0, 200);
  const subject = userSubject
    ? `${userSubject} · Solicitud de compra #${docEntry}`
    : `Solicitud de compra · Borrador #${docEntry}`;
  const { id_request: idRequest, processEmail, processEmails, taskEmails } = await createGeneralRequest({
    company: companyId,
    subject,
    descripcion: `${String(draft.Comments ?? '').slice(0, 900)}${total}`.trim(),
    process: config.id_process_category_auth,
    createdby: user.id,
    url: `/process/purchases?companyId=${companyId}&docEntry=${docEntry}`,
    formValues: [],
  });

  try {
    await prisma.purchaseAuthorization.create({
      data: { id_company: companyId, doc_entry: docEntry, id_request_general: idRequest, status: 'pending', created_by: user.id },
    });
  } catch {
    // Indice unico: otro envio del mismo borrador gano la carrera.
    await cancelGeneralRequest(idRequest);
    return { ok: false, status: 409, error: 'La solicitud ya tiene una autorizacion en curso.' };
  }

  try {
    const etagged = await sapGet<Record<string, unknown>>(sap, `Drafts(${docEntry})?$select=DocEntry,U_SEND_State`);
    if (normalizeState(etagged.U_SEND_State) !== state) throw new SapError('El borrador cambio durante el envio', 412);
    if (!(await isAuthorizationEffectEnabled(idRequest, 'on_start', 'purchase.state_to_authorize'))) {
      const id = await startStep({
        idRequest,
        stepKind: 'sap',
        stepName: 'Pasar a «Por autorizar»',
        actionKey: 'purchase.state_to_authorize',
        triggerEvent: 'on_start',
        triggeredBy: 'user',
        idUser: user.id,
        idCompany: companyId,
      });
      await finishStep(id, { status: 'skipped', responseSummary: 'Efecto no configurado en el flujo' });
    } else await withStep(
      {
        idRequest,
        stepKind: 'sap',
        stepName: 'Pasar a «Por autorizar»',
        actionKey: 'purchase.state_to_authorize',
        triggerEvent: 'on_start',
        triggeredBy: 'user',
        idUser: user.id,
        idCompany: companyId,
        sapEntity: 'Drafts',
        requestSummary: { docEntry, de: state, a: 'LA' },
      },
      () =>
        sapPatch(sap, `Drafts(${docEntry})`, { U_SEND_State: 'LA' }, false, {
          ifMatch: etagged['odata.etag'] as string | undefined,
        }),
      () => ({ status: 'ok', sapDocEntry: docEntry })
    );
  } catch (error) {
    // Sin LA no debe quedar una autorizacion viva: se revierte.
    await cancelGeneralRequest(idRequest);
    await prisma.purchaseAuthorization.update({
      where: { id_request_general: idRequest },
      data: { status: 'cancelled', error: error instanceof Error ? error.message.slice(0, 500) : 'Error' },
    });
    if (error instanceof SapError && error.isPreconditionFailed) {
      return { ok: false, status: 409, error: 'La solicitud cambio mientras se enviaba (posiblemente en SAPSEND). Recargue.' };
    }
    throw error;
  }

  // Aviso a encargados y autorizadores con el mismo mecanismo del workflow, SOLO
  // despues de que el borrador quedo en LA (SAPSEND avisaba antes del cambio de
  // estado: useSendToAuthorizePurchaseRequest.jsx:159-169). No bloquea.
  fireAndForgetNotification(
    notifyNewRequestTyped({ requestId: idRequest, subject, processEmail, processEmails, taskEmails, creatorEmail: userEmail })
  );

  // Tareas «Ejecutora SAP» no secuenciales que ya existen desde la creación. No bloquea.
  fireAndForgetNotification(import('../workflow-sap/engine').then((m) => m.runSapExecutors(idRequest)));

  return { ok: true, idRequestGeneral: idRequest, state: 'LA' };
}

/**
 * ¿Ya estan aprobadas TODAS las tareas de autorizacion de la plantilla de la
 * solicitud? Se compara contra la plantilla (task_process_category) y no contra las
 * tareas creadas, porque las secuenciales siguientes se crean despues
 * (advanceSequentialTask) y podrian no existir aun cuando llega este aviso.
 * Limitacion: si la plantilla tiene autorizaciones condicionadas a opciones del
 * formulario que no aplican, nunca se completarian; el flujo de compras no las usa.
 */
async function allAuthorizationsApproved(idRequest: number): Promise<boolean> {
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('req', sql.Int, idRequest).query(`
    WITH plantilla AS (
      SELECT DISTINCT tpc.id_process_category
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @req
    )
    SELECT
      (SELECT COUNT(*) FROM task_process_category tpc
        WHERE tpc.id_process_category IN (SELECT id_process_category FROM plantilla)
          AND tpc.is_authorization = 1) AS total,
      (SELECT COUNT(DISTINCT trg.id_task) FROM task_request_general trg
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        WHERE trg.id_request_general = @req AND tpc.is_authorization = 1 AND trg.id_status = 2) AS aprobadas;`);
  const row = r.recordset[0] ?? { total: 0, aprobadas: 0 };
  return Number(row.total) > 0 && Number(row.aprobadas) >= Number(row.total);
}

/** Marca el resultado sin romper al llamador (corre en segundo plano). */
async function finish(idRequest: number, data: { status: string; firm_doc_entry?: number; error?: string | null }) {
  await prisma.purchaseAuthorization.update({
    where: { id_request_general: idRequest },
    data: { ...data, error: data.error ? data.error.slice(0, 500) : null },
  });
}

/**
 * Reaccion a la decision del autorizador. No lanza: se invoca en segundo plano
 * desde update-activities (fire-and-forget), igual que la sincronizacion de Tesoreria.
 * Devuelve `skipped` si la solicitud no es de compras.
 */
export async function onAuthorizationDecision(
  idRequest: number | null | undefined,
  authorized: boolean,
  reason?: string | null,
  triggeredBy: TriggeredBy = 'user',
  /** 'executor' = lo pide una tarea «Ejecutora SAP» del flujo (no un efecto de la autorizacion). */
  source: 'decision' | 'executor' = 'decision'
): Promise<{ skipped: true } | { skipped: false; status: string; error?: string }> {
  if (!idRequest) return { skipped: true };

  // Efectos configurables en «Ver flujos»: si el flujo no tiene el efecto, no se ejecuta.
  if (authorized && source === 'decision' && triggeredBy !== 'retry') {
    if (!(await isAuthorizationEffectEnabled(Number(idRequest), 'on_final_approve', 'purchase.publish_firm'))) {
      return { skipped: true };
    }
  }

  // El flujo se edita en «Administrar flujos de trabajo» y puede tener VARIOS niveles
  // de autorizacion: solo se publica cuando estan aprobados todos los de la plantilla.
  // (Un rechazo en cualquier nivel si decide de una vez.)
  if (authorized && !(await allAuthorizationsApproved(Number(idRequest)))) return { skipped: true };

  // Reclamo atomico: solo una ejecucion procesa la decision.
  const claimed = await prisma.purchaseAuthorization.updateMany({
    // Solo una aprobacion fallida ('publish_error') se puede reintentar como aprobacion.
    where: { id_request_general: Number(idRequest), status: { in: authorized ? ['pending', 'publish_error'] : ['pending'] } },
    data: { status: authorized ? 'publishing' : 'rejected' },
  });
  if (claimed.count === 0) return { skipped: true };

  const link = await prisma.purchaseAuthorization.findUniqueOrThrow({ where: { id_request_general: Number(idRequest) } });
  let sap: SapSession | null = null;
  try {
    sap = await companySap(link.id_company);

    if (authorized) {
      const session = sap;
      const r = await withStep(
        {
          idRequest: link.id_request_general,
          stepKind: 'sap',
          stepName: 'Publicar solicitud en firme',
          actionKey: 'purchase.publish_firm',
          triggerEvent: source === 'executor' ? 'on_execute' : 'on_final_approve',
          triggeredBy,
          idCompany: link.id_company,
          sapEntity: 'PurchaseRequests',
          requestSummary: { borrador: link.doc_entry },
        },
        () => publishApprovedDraft(publishSap(session), link.doc_entry),
        (res) =>
          res.ok
            ? {
                status: 'ok',
                sapDocEntry: res.firmDocEntry,
                sapDocNum: res.firmDocNum ?? null,
                responseSummary: res.resumed ? 'Reanudada sin duplicar' : 'Creada',
              }
            : { status: 'error', error: res.error, responseSummary: { estado: res.state } }
      );
      if (r.ok) {
        await finish(link.id_request_general, { status: 'approved', firm_doc_entry: r.firmDocEntry });
        afterDecision(link.id_request_general, source);
        return { skipped: false, status: 'approved' };
      }
      await finish(link.id_request_general, { status: 'publish_error', error: r.error });
      return { skipped: false, status: 'publish_error', error: r.error };
    }

    // Rechazo: LA -> NAD con motivo, solo si sigue en LA (y si el flujo tiene ese efecto).
    if (!(await isAuthorizationEffectEnabled(link.id_request_general, 'on_reject', 'purchase.state_rejected'))) {
      const id = await startStep({
        idRequest: link.id_request_general,
        stepKind: 'sap',
        stepName: 'Pasar a «No aprobado»',
        actionKey: 'purchase.state_rejected',
        triggerEvent: 'on_reject',
        triggeredBy,
        idCompany: link.id_company,
      });
      await finishStep(id, { status: 'skipped', responseSummary: 'Efecto no configurado en el flujo' });
      await finish(link.id_request_general, { status: 'rejected' });
      afterDecision(link.id_request_general, source);
      return { skipped: false, status: 'rejected' };
    }
    const draft = await sapGet<Record<string, unknown>>(sap, `Drafts(${link.doc_entry})?$select=DocEntry,U_SEND_State`);
    const check = checkTransition(draft.U_SEND_State, 'no_aprobar');
    if (!check.ok) {
      await finish(link.id_request_general, { status: 'reject_error', error: check.error });
      return { skipped: false, status: 'reject_error', error: check.error };
    }
    const motivo = (reason ?? '').trim() || 'Rechazada en SynerLink';
    const session = sap;
    await withStep(
      {
        idRequest: link.id_request_general,
        stepKind: 'sap',
        stepName: 'Pasar a «No aprobado»',
        actionKey: 'purchase.state_rejected',
        triggerEvent: 'on_reject',
        triggeredBy,
        idCompany: link.id_company,
        sapEntity: 'Drafts',
        requestSummary: { docEntry: link.doc_entry, a: 'NAD', motivo: motivo.slice(0, 254) },
      },
      () =>
        sapPatch(
          session,
          `Drafts(${link.doc_entry})`,
          { U_SEND_State: 'NAD', U_Motivo_Can_Solicitud: motivo.slice(0, 254) },
          false,
          { ifMatch: draft['odata.etag'] as string | undefined }
        ),
      () => ({ status: 'ok', sapDocEntry: link.doc_entry })
    );
    await finish(link.id_request_general, { status: 'rejected' });
    afterDecision(link.id_request_general, source);
    return { skipped: false, status: 'rejected' };
  } catch (error) {
    const message = error instanceof SapError ? error.friendly : error instanceof Error ? error.message : 'Error';
    console.error(`Compras: no se pudo aplicar la decision de la solicitud ${idRequest}:`, message);
    const status = authorized ? 'publish_error' : 'reject_error';
    await finish(link.id_request_general, { status, error: message }).catch(() => undefined);
    return { skipped: false, status, error: message };
  } finally {
    if (sap) await sapLogout(sap);
  }
}

/**
 * ¿Puede este usuario decidir la tarea de autorizacion pendiente de la solicitud?
 * Misma regla de la bandeja (authorization-activities/route.js:64-118): asignada
 * a el, o sin asignar y el usuario esta en el pool (empresa accesible + tipo de
 * autorizacion + mismo departamento que el solicitante). Nunca el propio solicitante.
 */
async function canDecideAuthorization(idRequest: number, idUser: string): Promise<boolean> {
  const pool = await sql.connect(sqlConfig);
  const r = await pool
    .request()
    .input('req', sql.Int, idRequest)
    .input('idUser', sql.NVarChar(50), idUser)
    .query(`
      SELECT TOP 1 1 AS ok
      FROM task_request_general trg
      INNER JOIN requests_general rg ON rg.id = trg.id_request_general
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @req
        AND trg.id_status = 4
        AND tpc.is_authorization = 1
        AND tpc.type_authorization IS NOT NULL
        AND rg.id_requester <> @idUser
        AND (
          trg.id_assigned = @idUser
          OR (
            trg.id_assigned IS NULL
            AND rg.id_company IN (
              SELECT cu.id_company FROM company_user cu
              INNER JOIN subprocess_user_company suc ON suc.id_company_user = cu.id_company_user
              WHERE cu.id_user = @idUser)
            AND tpc.type_authorization IN (
              SELECT ut.type_authorization FROM user_types_authorization ut WHERE ut.id_user = @idUser)
            AND EXISTS (
              SELECT 1 FROM department_user du_c
              INNER JOIN department_user du_a ON du_a.id_department = du_c.id_department
              WHERE du_c.id_user = rg.id_requester AND du_a.id_user = @idUser)
          )
        );`);
  return r.recordset.length > 0;
}

/**
 * «Cotizar SC» de SAPSEND (ModalViewPurchaseRequest.jsx:300-349): el autorizador,
 * en vez de aprobar o rechazar, envia la solicitud a Compras para cotizar.
 * LA -> ENC, se cierra la autorizacion en curso (al reenviar se abre una nueva,
 * porque cambian los precios) y se avisa a Compras de la empresa.
 */
export async function sendToQuotation(params: {
  companyId: number;
  docEntry: number;
  userEmail: string;
  reason?: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { companyId, docEntry, userEmail } = params;

  const link = await prisma.purchaseAuthorization.findFirst({
    where: { id_company: companyId, doc_entry: docEntry, status: 'pending' },
  });
  if (!link) return { ok: false, status: 404, error: 'La solicitud no tiene una autorizacion pendiente.' };

  if (!(await isAuthorizationEffectEnabled(link.id_request_general, 'on_quote', 'purchase.state_quotation'))) {
    return { ok: false, status: 409, error: 'El flujo de esta solicitud no tiene habilitado «Enviar a cotizar».' };
  }

  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (!user || !(await canDecideAuthorization(link.id_request_general, user.id))) {
    return { ok: false, status: 403, error: 'No puede decidir la autorizacion de esta solicitud.' };
  }

  // Reclamo atomico: si otro ya decidio (autorizo/rechazo), no se cotiza.
  const claimed = await prisma.purchaseAuthorization.updateMany({
    where: { id_request_general: link.id_request_general, status: 'pending' },
    data: { status: 'quoted' },
  });
  if (claimed.count === 0) return { ok: false, status: 409, error: 'La autorizacion ya fue decidida.' };

  let sap: SapSession | null = null;
  try {
    sap = await companySap(companyId);
    const draft = await sapGet<Record<string, unknown>>(sap, `Drafts(${docEntry})?$select=DocEntry,U_SEND_State,Comments`);
    const check = checkTransition(draft.U_SEND_State, 'cotizar');
    if (!check.ok) throw new Error(check.error);
    const session = sap;
    await withStep(
      {
        idRequest: link.id_request_general,
        stepKind: 'sap',
        stepName: 'Pasar a «En cotización»',
        actionKey: 'purchase.state_quotation',
        triggerEvent: 'on_quote',
        triggeredBy: 'user',
        idUser: user.id,
        idCompany: companyId,
        sapEntity: 'Drafts',
        requestSummary: { docEntry, a: 'ENC', motivo: (params.reason ?? '').trim() || null },
      },
      () =>
        sapPatch(session, `Drafts(${docEntry})`, { U_SEND_State: 'ENC' }, false, {
          ifMatch: draft['odata.etag'] as string | undefined,
        }),
      () => ({ status: 'ok', sapDocEntry: docEntry })
    );
  } catch (error) {
    // El borrador sigue en LA: se devuelve la autorizacion a pendiente.
    await prisma.purchaseAuthorization
      .update({ where: { id_request_general: link.id_request_general }, data: { status: 'pending' } })
      .catch(() => undefined);
    if (sap) await sapLogout(sap);
    if (error instanceof SapError && error.isPreconditionFailed) {
      return { ok: false, status: 409, error: 'La solicitud cambio en SAP (posiblemente en SAPSEND). Recargue.' };
    }
    return { ok: false, status: 409, error: error instanceof SapError ? error.friendly : (error as Error).message };
  }

  // Desde aqui el borrador YA esta en ENC: lo que falle se registra, no se revierte.
  try {
    const draftComments = await sapGet<Record<string, unknown>>(sap, `Drafts(${docEntry})?$select=Comments`)
      .then((d) => String(d.Comments ?? ''))
      .catch(() => '');
    const reason = (params.reason ?? '').trim();
    await finish(link.id_request_general, { status: 'quoted', error: reason ? `Cotizar: ${reason}` : null });
    // Tareas SAP «si se envía a cotizar» antes de cerrar la solicitud del workflow.
    await import('../workflow-sap/engine').then((m) => m.runSapExecutors(link.id_request_general, 'user'));
    await cancelGeneralRequest(link.id_request_general).catch((e) =>
      console.error(`Compras: no se pudo cerrar la solicitud ${link.id_request_general} tras cotizar:`, e)
    );

    const config = await prisma.purchaseCompanyConfig.findUnique({ where: { id_company: companyId } });
    const compras = (config?.compras_emails ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    if (compras.length > 0) {
      fireAndForgetNotification(
        createAndSendNotificationsTyped(compras, {
          title: 'Solicitud de compra para cotizar · SynerLink',
          body: `El borrador #${docEntry} paso a cotizacion.${reason ? ` Motivo: ${reason}` : ''} ${draftComments.slice(0, 200)}`.trim(),
          url: `/process/purchases?companyId=${companyId}&docEntry=${docEntry}`,
          tag: `purchase-quote-${companyId}-${docEntry}`,
        })
      );
    }
    return { ok: true };
  } finally {
    await sapLogout(sap);
  }
}

/**
 * Tarea SAP «Pasar a Por autorizar»: deja el borrador en LA. Idempotente: si ya
 * esta en LA (porque lo dejo el envio) no hace nada. Solo desde B o ENC.
 */
export async function moveDraftToAuthorize(
  idRequest: number,
  triggeredBy: TriggeredBy
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const link = await prisma.purchaseAuthorization.findUnique({ where: { id_request_general: idRequest } });
  if (!link) return { ok: false, error: 'La solicitud no está enlazada a un borrador de compra.' };
  const sap = await companySap(link.id_company);
  try {
    const draft = await sapGet<Record<string, unknown>>(sap, `Drafts(${link.doc_entry})?$select=DocEntry,U_SEND_State`);
    const state = normalizeState(draft.U_SEND_State);
    if (state === 'LA') return { ok: true, detail: `Borrador ${link.doc_entry} ya está «Por autorizar»` };
    const check = checkTransition(state, state === 'ENC' ? 'reenviar' : 'enviar');
    if (!check.ok) return { ok: false, error: check.error };
    await withStep(
      {
        idRequest,
        stepKind: 'sap',
        stepName: 'Pasar a «Por autorizar»',
        actionKey: 'purchase.state_to_authorize',
        triggerEvent: 'on_execute',
        triggeredBy,
        idCompany: link.id_company,
        sapEntity: 'Drafts',
        requestSummary: { docEntry: link.doc_entry, de: state, a: 'LA' },
      },
      () =>
        sapPatch(sap, `Drafts(${link.doc_entry})`, { U_SEND_State: 'LA' }, false, {
          ifMatch: draft['odata.etag'] as string | undefined,
        }),
      () => ({ status: 'ok', sapDocEntry: link.doc_entry })
    );
    return { ok: true, detail: `Borrador ${link.doc_entry} pasó a «Por autorizar»` };
  } catch (e) {
    return { ok: false, error: e instanceof SapError ? e.friendly : (e as Error).message };
  } finally {
    await sapLogout(sap);
  }
}

/** Reintenta publicar una aprobacion que quedo en error (es idempotente). */
export function retryPublish(idRequest: number) {
  return onAuthorizationDecision(idRequest, true, null, 'retry');
}
