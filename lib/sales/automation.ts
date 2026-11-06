import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { companySap } from '../purchases/authorization';
import { createGeneralRequest } from '../requests-general/createGeneralRequest';
import { sapGet, sapGetAll, sapLogout, sapPatch, SapError, type SapSession } from '../sap/serviceLayer';
import { runSapExecutors } from '../workflow-sap/engine';
import { withStep } from '../workflow-sap/executionLog';
import { simulateDraft } from './flow';
import { offerSubject } from './offer';
import { normalizeState } from './states';

/**
 * Automatización de los borradores de pedido que llegan de Salesforce (OLP), con
 * panel estilo Transferencias Nabuco. Cada borrador nuevo (oOrders, estado B, creado
 * por el usuario SAP de la integración) se pasa al flujo «Oferta de venta»: se crea
 * la solicitud, se enlaza el borrador y arrancan las Tareas SAP (cupo → autorizaciones
 * → pedido). En simulación no escribe nada: solo registra qué haría.
 *
 * Garantías: un borrador nunca se pasa dos veces (índice único en sales_automation_doc
 * y en sales_authorization viva); una sola corrida a la vez por empresa (lock con
 * caducidad de 30 min); nunca lanza hacia el programador sin registrar la corrida.
 */

export type Origen = 'programada' | 'manual' | 'asistida';
export const MAX_POR_CORRIDA = 30;

export interface AutomationConfig {
  id_company: number;
  activo: boolean;
  simulacion: boolean;
  intervalo_min: number;
  /** Usuarios SAP (UserSign) que crean los borradores; en BD va como lista «14,30». */
  user_signs: number[];
  desde_fecha: string | null;
  id_user_solicitante: string | null;
  id_job: number | null;
  en_ejecucion_desde: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface Candidate {
  DocEntry: number;
  DocNum: number | null;
  CardCode: string;
  CardName: string;
  DocTotal: number;
  DocDate: string;
}

export interface DocResult {
  docEntry: number;
  estado: 'simulado' | 'enviado' | 'error' | 'omitido';
  destino?: string | null;
  detalle?: string;
  error?: string;
  idRequest?: number;
}

/**
 * «Represado» (Nicolás Rivera, 2026-11-05: «si da error, debería quedarse represada»): el
 * borrador no siguió su camino y queda visible en el panel con el error y «Reintentar».
 *  - 'reenviar': falló el paso al flujo (antes de crear la solicitud) → se vuelve a
 *    pasar el borrador al flujo. (Desde la RN del 2026-11-05 la dirección ya no bloquea:
 *    un «Revisar dirección» que haya quedado registrado se reintenta y pasa.)
 *  - 'pedido': la solicitud existe pero falló la creación del pedido (publish_error) →
 *    se reintentan sus Tareas SAP (lo mismo que «Reintentar» en la oferta).
 *  - 'tarea': la solicitud existe y otra Tarea SAP quedó en error (p. ej. pasar a
 *    extracupo, solicitud 10154 / borrador 901: «"COP" is not valid JSON») → igual,
 *    se reintentan sus Tareas SAP; al pasar, aparece la autorización.
 * Usa los datos existentes (sales_automation_doc + sales_authorization). PURA.
 */
export type RetryKind = 'reenviar' | 'pedido' | 'tarea';
export const SAP_TASK_ERROR_PREFIX = '[sap:error]';
export function represadoOf(d: {
  estado?: string | null;
  error?: string | null;
  estado_flujo?: string | null;
  error_flujo?: string | null;
  /** resolution de una Tarea SAP abierta en error («[sap:error] …»), si la hay. */
  error_tarea?: string | null;
}): { accion: RetryKind; mensaje: string } | null {
  if (d.estado === 'error') return { accion: 'reenviar', mensaje: d.error || 'No se pudo pasar el borrador al flujo.' };
  if (d.estado !== 'enviado') return null;
  if (d.estado_flujo === 'publish_error') return { accion: 'pedido', mensaje: d.error_flujo || 'No se pudo crear el pedido en SAP.' };
  if ((d.estado_flujo === 'pending' || d.estado_flujo === 'publishing') && d.error_tarea) {
    const msg = d.error_tarea.startsWith(SAP_TASK_ERROR_PREFIX) ? d.error_tarea.slice(SAP_TASK_ERROR_PREFIX.length).trim() : d.error_tarea.trim();
    return { accion: 'tarea', mensaje: `Tarea SAP en error: ${msg || 'sin detalle'}` };
  }
  return null;
}

/** Primera Tarea SAP abierta (id_status 4) en error de la solicitud d (columna error_tarea). En LIKE el «[» se escapa. */
const ERROR_TAREA_SQL = `(SELECT TOP 1 trg.resolution FROM dbo.task_request_general trg
    WHERE trg.id_request_general = d.id_request_general AND trg.id_status = 4 AND trg.resolution LIKE N'[[]sap:error]%' ORDER BY trg.id)`;

/** Condición SQL equivalente a represadoOf (alias d = sales_automation_doc, sa = sales_authorization). */
const REPRESADO_SQL = `(d.estado = N'error' OR (d.estado = N'enviado' AND (sa.status = N'publish_error'
    OR (sa.status IN (N'pending', N'publishing') AND ${ERROR_TAREA_SQL} IS NOT NULL))))`;

const pool = () => sql.connect(sqlConfig);
const friendly = (e: unknown) => (e instanceof SapError ? e.friendly : e instanceof Error ? e.message : String(e));

export async function getConfig(idCompany: number): Promise<AutomationConfig | null> {
  const p = await pool();
  const r = await p.request().input('c', sql.Int, idCompany).query(`
    SELECT id_company, activo, simulacion, intervalo_min, user_sign, CONVERT(varchar(10), desde_fecha, 23) AS desde_fecha,
           id_user_solicitante, id_job, en_ejecucion_desde, updated_by, updated_at
    FROM dbo.sales_automation_config WHERE id_company = @c;`);
  const row = r.recordset[0];
  if (!row) return null;
  const { user_sign, ...rest } = row;
  return { ...rest, user_signs: parseUserSigns(user_sign), activo: Boolean(row.activo), simulacion: Boolean(row.simulacion) };
}

export interface ConfigInput {
  activo: boolean;
  simulacion: boolean;
  intervalo_min: number;
  user_signs: number[];
  desde_fecha: string | null;
  id_user_solicitante: string | null;
}

/** «14, 30» (o un número suelto) → [14, 30], sin repetidos. Lo que no sea entero positivo queda como NaN para que la validación lo rechace. PURA. */
export function parseUserSigns(v: unknown): number[] {
  if (v == null || v === '') return [];
  const list = Array.isArray(v) ? v : String(v).split(/[,;\s]+/);
  const out = list.filter((x) => String(x).trim() !== '').map((x) => (/^\d+$/.test(String(x).trim()) ? Number(String(x).trim()) : NaN));
  return [...new Set(out)];
}

/** Valida la configuración; devuelve errores (vacío = válida). PURA. */
export function validateConfig(c: ConfigInput): string[] {
  const e: string[] = [];
  if (!Number.isInteger(c.intervalo_min) || c.intervalo_min < 5 || c.intervalo_min > 1440) e.push('El intervalo debe estar entre 5 y 1440 minutos.');
  if (c.user_signs.some((u) => !Number.isInteger(u) || u <= 0)) e.push('Los usuarios SAP de la integración deben ser números separados por coma.');
  if (c.user_signs.length > 10) e.push('Indique como máximo 10 usuarios SAP.');
  if (c.desde_fecha != null && !/^\d{4}-\d{2}-\d{2}$/.test(c.desde_fecha)) e.push('La fecha «desde» no es válida.');
  if (c.activo && !c.user_signs.length) e.push('Para activarla, indique el usuario SAP que crea los borradores (UserSign).');
  if (c.activo && !c.id_user_solicitante) e.push('Para activarla, indique el solicitante en SynerLink.');
  return e;
}

/** Cron de «cada N minutos» para el programador central. PURA. */
export function cronFor(minutes: number): string {
  if (minutes < 60) return `*/${minutes} * * * *`;
  const h = Math.max(1, Math.round(minutes / 60));
  return `0 */${h} * * *`;
}

/** Guarda la configuración y crea/actualiza su tarea «ventas_automatizar» en el programador. */
export async function saveConfig(idCompany: number, c: ConfigInput, actor: string): Promise<void> {
  const p = await pool();
  const tx = new sql.Transaction(p);
  await tx.begin();
  try {
    const cur = await new sql.Request(tx).input('c', sql.Int, idCompany).query(`SELECT id_job FROM dbo.sales_automation_config WITH (UPDLOCK) WHERE id_company = @c;`);
    let idJob: number | null = cur.recordset[0]?.id_job ?? null;
    const name = `Ventas · Automatización de borradores de Salesforce (empresa ${idCompany})`;
    const cron = cronFor(c.intervalo_min);
    if (idJob == null) {
      const j = await new sql.Request(tx)
        .input('name', sql.NVarChar(200), name)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify({ id_company: idCompany }))
        .input('cron', sql.NVarChar(100), cron)
        .input('active', sql.Bit, c.activo ? 1 : 0)
        .input('by', sql.NVarChar(100), actor).query(`
          INSERT INTO dbo.scheduled_job (name, job_type, payload, cron_expression, next_run_date, active, source_module, created_by)
          OUTPUT INSERTED.id VALUES (@name, N'ventas_automatizar', @payload, @cron, DATEADD(MINUTE, 1, GETDATE()), @active, N'ventas', @by);`);
      idJob = j.recordset[0].id;
    } else {
      await new sql.Request(tx)
        .input('id', sql.Int, idJob)
        .input('cron', sql.NVarChar(100), cron)
        .input('active', sql.Bit, c.activo ? 1 : 0)
        .query(`UPDATE dbo.scheduled_job SET cron_expression = @cron, active = @active,
                  next_run_date = CASE WHEN @active = 1 AND next_run_date < GETDATE() THEN DATEADD(MINUTE, 1, GETDATE()) ELSE next_run_date END
                WHERE id = @id;`);
    }
    await new sql.Request(tx)
      .input('c', sql.Int, idCompany)
      .input('activo', sql.Bit, c.activo ? 1 : 0)
      .input('sim', sql.Bit, c.simulacion ? 1 : 0)
      .input('int', sql.Int, c.intervalo_min)
      .input('us', sql.NVarChar(100), c.user_signs.length ? c.user_signs.join(',') : null)
      .input('desde', sql.Date, c.desde_fecha)
      .input('sol', sql.NVarChar(50), c.id_user_solicitante)
      .input('job', sql.Int, idJob)
      .input('by', sql.NVarChar(50), actor).query(`
        MERGE dbo.sales_automation_config AS t
        USING (SELECT @c AS id_company) AS s ON t.id_company = s.id_company
        WHEN MATCHED THEN UPDATE SET activo = @activo, simulacion = @sim, intervalo_min = @int, user_sign = @us,
             desde_fecha = @desde, id_user_solicitante = @sol, id_job = @job, updated_by = @by, updated_at = sysutcdatetime()
        WHEN NOT MATCHED THEN INSERT (id_company, activo, simulacion, intervalo_min, user_sign, desde_fecha, id_user_solicitante, id_job, updated_by)
             VALUES (@c, @activo, @sim, @int, @us, @desde, @sol, @job, @by);`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  }
}

async function takeLock(idCompany: number): Promise<boolean> {
  const p = await pool();
  const r = await p.request().input('c', sql.Int, idCompany).query(`
    UPDATE dbo.sales_automation_config SET en_ejecucion_desde = sysutcdatetime()
    WHERE id_company = @c AND (en_ejecucion_desde IS NULL OR en_ejecucion_desde < DATEADD(MINUTE, -30, sysutcdatetime()));`);
  return (r.rowsAffected[0] ?? 0) === 1;
}

async function releaseLock(idCompany: number) {
  const p = await pool();
  await p.request().input('c', sql.Int, idCompany).query(`UPDATE dbo.sales_automation_config SET en_ejecucion_desde = NULL WHERE id_company = @c;`);
}

/** Filtro OData de candidatos. PURA. */
export function candidatesFilter(userSigns: number[], desde: string | null): string {
  const users = userSigns.filter((u) => Number.isInteger(u) && u > 0).map((u) => `UserSign eq ${Math.trunc(u)}`);
  const parts = [
    "DocObjectCode eq 'oOrders'",
    // Sin estado también: Salesforce puede crear el borrador sin U_SEND_State (el campo no tiene valor por defecto).
    "(U_SEND_State eq 'B' or U_SEND_State eq null)",
    "DocumentStatus eq 'bost_Open'",
    users.length === 1 ? users[0] : `(${users.join(' or ')})`,
  ];
  if (desde && /^\d{4}-\d{2}-\d{2}$/.test(desde)) parts.push(`DocDate ge '${desde}'`);
  return parts.join(' and ');
}

/** Borradores ya pasados al flujo o descartados (no se vuelven a tomar). */
async function alreadyHandled(idCompany: number): Promise<Set<number>> {
  const p = await pool();
  const r = await p.request().input('c', sql.Int, idCompany).query(`
    SELECT doc_entry FROM dbo.sales_automation_doc WHERE id_company = @c AND estado IN (N'enviado', N'descartado')
    UNION
    SELECT doc_entry FROM dbo.sales_authorization WHERE id_company = @c AND status IN (N'pending', N'publishing', N'publish_error', N'approved')
    UNION
    -- Ofertas creadas en SynerLink y guardadas en borrador: las envía su autor, no la automatización.
    SELECT doc_entry FROM dbo.sales_offer_draft WHERE id_company = @c;`);
  return new Set(r.recordset.map((x: { doc_entry: number }) => Number(x.doc_entry)));
}

/** Pendientes en SAP (mismo filtro que la corrida). */
export async function findPending(sap: SapSession, cfg: AutomationConfig, limit = 200): Promise<Candidate[]> {
  if (!cfg.user_signs.length) return [];
  const rows = await sapGetAll<Candidate>(
    sap,
    `Drafts?$select=DocEntry,DocNum,CardCode,CardName,DocTotal,DocDate&$filter=${candidatesFilter(cfg.user_signs, cfg.desde_fecha)}&$orderby=DocEntry asc`,
    { cap: 2000 }
  );
  const handled = await alreadyHandled(cfg.id_company);
  return rows.filter((r) => !handled.has(Number(r.DocEntry))).slice(0, limit);
}

async function recordDoc(idCompany: number, c: Partial<Candidate> & { DocEntry: number }, d: { estado: string; destino?: string | null; detalle?: string | null; error?: string | null; idRequest?: number | null; usuario?: string | null }) {
  const p = await pool();
  await p
    .request()
    .input('c', sql.Int, idCompany)
    .input('d', sql.Int, c.DocEntry)
    .input('num', sql.Int, c.DocNum ?? null)
    .input('card', sql.NVarChar(50), c.CardCode ?? null)
    .input('name', sql.NVarChar(200), (c.CardName ?? '').slice(0, 200) || null)
    .input('total', sql.Decimal(19, 6), c.DocTotal ?? null)
    .input('estado', sql.NVarChar(20), d.estado)
    .input('destino', sql.NVarChar(20), d.destino ?? null)
    .input('detalle', sql.NVarChar(1000), (d.detalle ?? '').slice(0, 1000) || null)
    .input('error', sql.NVarChar(1000), (d.error ?? '').slice(0, 1000) || null)
    .input('req', sql.Int, d.idRequest ?? null)
    .input('u', sql.NVarChar(50), d.usuario ?? null).query(`
      MERGE dbo.sales_automation_doc AS t
      USING (SELECT @c AS id_company, @d AS doc_entry) AS s ON t.id_company = s.id_company AND t.doc_entry = s.doc_entry
      WHEN MATCHED AND t.estado <> N'enviado' THEN UPDATE SET doc_num = COALESCE(@num, t.doc_num), card_code = COALESCE(@card, t.card_code),
           card_name = COALESCE(@name, t.card_name), doc_total = COALESCE(@total, t.doc_total), estado = @estado, destino = @destino,
           detalle = @detalle, error = @error, id_request_general = COALESCE(@req, t.id_request_general),
           intentos = t.intentos + CASE WHEN @estado IN (N'enviado', N'error') THEN 1 ELSE 0 END, usuario_accion = @u, updated_at = sysutcdatetime()
      WHEN NOT MATCHED THEN INSERT (id_company, doc_entry, doc_num, card_code, card_name, doc_total, estado, destino, detalle, error, id_request_general, intentos, usuario_accion)
           VALUES (@c, @d, @num, @card, @name, @total, @estado, @destino, @detalle, @error, @req, CASE WHEN @estado IN (N'enviado', N'error') THEN 1 ELSE 0 END, @u);`);
}

/** Pasa UN borrador al flujo «Oferta de venta» (crea la solicitud y el enlace; arranca las Tareas SAP). */
async function sendToFlow(sap: SapSession, cfg: AutomationConfig, c: Candidate, usuario: string | null): Promise<DocResult> {
  const p = await pool();
  const conf = await p.request().input('c', sql.Int, cfg.id_company).query(
    `SELECT TOP 1 id_process_category_oferta AS id_proceso FROM dbo.sales_company_config WHERE id_company = @c AND activo = 1;`
  );
  const processId = Number(conf.recordset[0]?.id_proceso ?? 0);
  if (!processId) throw new Error('La empresa no tiene configurado el flujo «Oferta de venta» (sales_company_config).');
  if (!cfg.id_user_solicitante) throw new Error('Falta el solicitante en SynerLink en la configuración.');

  // Releer el borrador justo antes: debe seguir en B y sin enlace vivo.
  const draft = await sapGet<Record<string, unknown>>(
    sap,
    `Drafts(${c.DocEntry})?$select=DocEntry,U_SEND_State,DocumentStatus,Comments,DocTotal,CardCode,CardName,ShipToCode,AddressExtension,DocumentLines`
  );
  const sinEstado = draft.U_SEND_State == null || String(draft.U_SEND_State).trim() === '';
  const state = normalizeState(draft.U_SEND_State);
  if ((state !== 'B' && !sinEstado) || draft.DocumentStatus !== 'bost_Open') {
    return { docEntry: c.DocEntry, estado: 'omitido', detalle: `El borrador ya no está en borrador abierto (estado ${state ?? String(draft.U_SEND_State)}).` };
  }
  // RN 2026-11-05: la dirección no bloquea; el pedido resuelve el ShipToCode al crearse (publish.ts).
  // Borrador de Salesforce sin estado: se marca en B para que el flujo lo evalúe (sin If-Match: el etag de Drafts es fijo).
  if (sinEstado) await sapPatch(sap, `Drafts(${c.DocEntry})`, { U_SEND_State: 'B' });
  const first = ((draft.DocumentLines as Record<string, unknown>[] | undefined) ?? [])[0];
  const subject = offerSubject(draft.CardName ?? c.CardName, draft.CardCode ?? c.CardCode, first?.ItemDescription ?? first?.ItemCode);
  const { id_request: idRequest } = await createGeneralRequest({
    company: cfg.id_company,
    subject,
    descripcion: `Borrador creado desde Salesforce. ${String(draft.Comments ?? '').slice(0, 700)} · Total ${Number(c.DocTotal ?? 0).toLocaleString('es-CO')}`.trim(),
    process: processId,
    createdby: cfg.id_user_solicitante,
    url: `/process/sales?companyId=${cfg.id_company}&docEntry=${c.DocEntry}`,
    formValues: [],
  });
  try {
    await p
      .request()
      .input('c', sql.Int, cfg.id_company)
      .input('d', sql.Int, c.DocEntry)
      .input('r', sql.Int, idRequest)
      .input('u', sql.NVarChar(50), cfg.id_user_solicitante)
      .query(`INSERT INTO dbo.sales_authorization (id_company, doc_entry, id_request_general, etapa, status, created_by)
              VALUES (@c, @d, @r, N'oferta', N'pending', @u);`);
  } catch {
    // Índice único: el borrador ya tiene un enlace vivo (otra corrida ganó). Se cancela la solicitud creada.
    await p.request().input('id', sql.Int, idRequest).query(`UPDATE requests_general SET status_req = 3 WHERE id = @id;
      UPDATE task_request_general SET id_status = 3 WHERE id_request_general = @id AND id_status = 4;`);
    return { docEntry: c.DocEntry, estado: 'omitido', detalle: 'El borrador ya estaba en un flujo.' };
  }
  await withStep(
    { idRequest, stepKind: 'system', stepName: 'Tomado de Salesforce por la automatización', actionKey: 'sales.automation', triggerEvent: 'on_execute', triggeredBy: usuario ? 'user' : 'server', idUser: usuario, idCompany: cfg.id_company, sapEntity: 'Drafts', requestSummary: { borrador: c.DocEntry, cliente: c.CardCode } },
    async () => idRequest,
    () => ({ status: 'ok', sapDocEntry: c.DocEntry })
  );
  await recordDoc(cfg.id_company, c, { estado: 'enviado', detalle: `Solicitud #${idRequest} creada`, idRequest, usuario });
  // Tareas SAP del flujo (evaluar cupo → autorizaciones → pedido). No bloquea la corrida.
  void runSapExecutors(idRequest, usuario ? 'user' : 'server').catch((e) => console.error('[sales/automation] tareas SAP', e));
  return { docEntry: c.DocEntry, estado: 'enviado', idRequest, detalle: `Solicitud #${idRequest}` };
}

export interface RunSummary {
  omitido?: string;
  simulacion: boolean;
  candidatos: number;
  enviados: number;
  simulados: number;
  errores: number;
  resultados: DocResult[];
}

/**
 * Una corrida. `modo`:
 *  - 'auto'     (programada / Ejecutar ahora): respeta «simulación» de la configuración.
 *  - 'simular'  (asistida): solo simula los borradores indicados.
 *  - 'crear'    (asistida): pasa al flujo los indicados, aunque la configuración esté en simulación.
 */
export async function runAutomation(params: {
  idCompany: number;
  origen: Origen;
  modo: 'auto' | 'simular' | 'crear';
  usuario?: string | null;
  docEntries?: number[];
}): Promise<RunSummary> {
  const { idCompany, origen, modo } = params;
  const usuario = params.usuario ?? null;
  const cfg = await getConfig(idCompany);
  const empty = (omitido: string): RunSummary => ({ omitido, simulacion: true, candidatos: 0, enviados: 0, simulados: 0, errores: 0, resultados: [] });
  if (!cfg) return empty('La empresa no tiene configuración de automatización.');
  if (origen === 'programada' && !cfg.activo) return empty('La automatización está pausada.');
  if (!cfg.user_signs.length) return empty('Falta el usuario SAP de la integración (UserSign).');
  if (!(await takeLock(idCompany))) return empty('Hay otra corrida en curso; intente en unos minutos.');

  const simulacion = modo === 'simular' || (modo === 'auto' && cfg.simulacion);
  const summary: RunSummary = { simulacion, candidatos: 0, enviados: 0, simulados: 0, errores: 0, resultados: [] };
  const p = await pool();
  const run = await p
    .request()
    .input('c', sql.Int, idCompany)
    .input('o', sql.NVarChar(20), origen)
    .input('u', sql.NVarChar(50), usuario)
    .input('s', sql.Bit, simulacion ? 1 : 0)
    .query(`INSERT INTO dbo.sales_automation_run (id_company, origen, usuario, simulacion) OUTPUT INSERTED.id VALUES (@c, @o, @u, @s);`);
  const idRun = run.recordset[0].id as number;

  let sap: SapSession | null = null;
  try {
    sap = await companySap(idCompany);
    let list = await findPending(sap, cfg, 2000);
    if (params.docEntries?.length) {
      const wanted = new Set(params.docEntries.map(Number));
      list = list.filter((c) => wanted.has(Number(c.DocEntry)));
    }
    list = list.slice(0, MAX_POR_CORRIDA);
    summary.candidatos = list.length;
    for (const c of list) {
      try {
        if (simulacion) {
          const sim = await simulateDraft(sap, idCompany, c.DocEntry);
          await recordDoc(idCompany, c, { estado: 'simulado', destino: sim.destino, detalle: sim.detalle, usuario });
          summary.simulados++;
          summary.resultados.push({ docEntry: c.DocEntry, estado: 'simulado', destino: sim.destino, detalle: sim.detalle });
        } else {
          const r = await sendToFlow(sap, cfg, c, usuario);
          if (r.estado === 'enviado') summary.enviados++;
          summary.resultados.push(r);
        }
      } catch (e) {
        const msg = friendly(e);
        await recordDoc(idCompany, c, { estado: 'error', error: msg, usuario }).catch(() => undefined);
        summary.errores++;
        summary.resultados.push({ docEntry: c.DocEntry, estado: 'error', error: msg });
      }
    }
  } catch (e) {
    summary.errores++;
    summary.omitido = friendly(e);
  } finally {
    if (sap) await sapLogout(sap);
    await releaseLock(idCompany);
    await p
      .request()
      .input('id', sql.Int, idRun)
      .input('cand', sql.Int, summary.candidatos)
      .input('env', sql.Int, summary.enviados)
      .input('sim', sql.Int, summary.simulados)
      .input('err', sql.Int, summary.errores)
      .input('det', sql.NVarChar(1000), summaryText(summary).slice(0, 1000))
      .query(`UPDATE dbo.sales_automation_run SET fin = sysutcdatetime(), candidatos = @cand, enviados = @env, simulados = @sim, errores = @err, detalle = @det WHERE id = @id;`)
      .catch(() => undefined);
  }
  return summary;
}

/** Texto corto de la corrida (historial y programador). PURA. */
export function summaryText(s: Pick<RunSummary, 'omitido' | 'simulacion' | 'candidatos' | 'enviados' | 'simulados' | 'errores'>): string {
  if (s.omitido && s.candidatos === 0) return `Sin procesar: ${s.omitido}`;
  const base = `${s.candidatos} borrador(es) nuevos`;
  const parts = s.simulacion ? [`${s.simulados} simulado(s)`] : [`${s.enviados} pasado(s) al flujo`];
  if (s.errores) parts.push(`${s.errores} con error`);
  return `${s.simulacion ? 'Simulación · ' : ''}${base}: ${parts.join(', ')}.${s.omitido ? ` ${s.omitido}` : ''}`;
}

/** Descartar / volver a intentar un borrador del registro (desde el panel). */
export async function docAction(idCompany: number, idDoc: number, accion: 'descartar' | 'reactivar', usuario: string): Promise<boolean> {
  const p = await pool();
  const r = await p
    .request()
    .input('c', sql.Int, idCompany)
    .input('id', sql.Int, idDoc)
    .input('u', sql.NVarChar(50), usuario)
    .input('estado', sql.NVarChar(20), accion === 'descartar' ? 'descartado' : 'simulado')
    .query(`UPDATE dbo.sales_automation_doc SET estado = @estado, usuario_accion = @u, updated_at = sysutcdatetime(),
              detalle = CASE WHEN @estado = N'descartado' THEN N'Descartado desde el panel' ELSE N'Vuelve a quedar pendiente' END
            WHERE id = @id AND id_company = @c AND estado IN (N'simulado', N'error', N'descartado');`);
  return (r.rowsAffected[0] ?? 0) === 1;
}

/**
 * «Reintentar» un borrador represado desde el panel: repite SOLO la acción que falló.
 *  - 'pedido'   → runSapExecutors(solicitud, 'retry'), igual que /api/sales/retry (idempotente).
 *  - 'reenviar' → vuelve a pasar el borrador al flujo (corrida asistida de ese borrador).
 */
export async function retryDoc(idCompany: number, idDoc: number, usuario: string | null): Promise<{ ok: boolean; accion?: RetryKind; detalle: string }> {
  const p = await pool();
  const r = await p.request().input('c', sql.Int, idCompany).input('id', sql.Int, idDoc).query(`
    SELECT TOP 1 d.doc_entry, d.estado, d.error, d.id_request_general, sa.status AS estado_flujo, sa.error AS error_flujo,
           ${ERROR_TAREA_SQL} AS error_tarea
    FROM dbo.sales_automation_doc d LEFT JOIN dbo.sales_authorization sa ON sa.id_request_general = d.id_request_general
    WHERE d.id = @id AND d.id_company = @c;`);
  const row = r.recordset[0];
  if (!row) return { ok: false, detalle: 'No se encontró ese borrador en el registro.' };
  const rep = represadoOf(row);
  if (!rep) return { ok: false, detalle: 'Ese borrador ya no está represado; actualice el panel.' };
  if (rep.accion === 'pedido' || rep.accion === 'tarea') {
    const idRequest = Number(row.id_request_general);
    const res = await runSapExecutors(idRequest, 'retry');
    const after = await p.request().input('r', sql.Int, idRequest).query(`SELECT TOP 1 status, error, order_doc_entry FROM dbo.sales_authorization WHERE id_request_general = @r;`);
    const sa = after.recordset[0];
    if (sa?.status === 'approved') return { ok: true, accion: 'pedido', detalle: `Pedido creado en SAP${sa.order_doc_entry ? ` (DocEntry ${sa.order_doc_entry})` : ''} · solicitud #${idRequest}.` };
    if (sa?.status === 'publish_error') return { ok: false, accion: rep.accion, detalle: sa.error || 'Sigue sin crearse el pedido.' };
    return { ok: res.errors === 0, accion: rep.accion, detalle: res.errors ? `Solicitud #${idRequest}: una Tarea SAP sigue en error.` : `Solicitud #${idRequest}: Tareas SAP reintentadas.` };
  }
  const s = await runAutomation({ idCompany, origen: 'asistida', modo: 'crear', usuario, docEntries: [Number(row.doc_entry)] });
  const res = s.resultados.find((x) => Number(x.docEntry) === Number(row.doc_entry));
  if (!res) return { ok: false, accion: 'reenviar', detalle: s.omitido || `El borrador ${row.doc_entry} ya no está pendiente en SAP (no está en borrador abierto o ya pasó al flujo).` };
  if (res.estado === 'enviado') return { ok: true, accion: 'reenviar', detalle: `Pasado al flujo · ${res.detalle ?? ''}`.trim() };
  return { ok: false, accion: 'reenviar', detalle: res.error || res.detalle || 'No se pudo pasar al flujo.' };
}

/** Máximo de represados que se reintentan en una sola acción masiva. */
export const MAX_REINTENTO_MASIVO = 30;

/** «Reintentar todos»: repite, uno a uno, la acción que falló en cada borrador represado (hasta MAX_REINTENTO_MASIVO). */
export async function retryAll(idCompany: number, usuario: string | null): Promise<{ total: number; ok: number; fallidos: number; pendientes: number; resultados: { idDoc: number; docEntry: number; ok: boolean; detalle: string }[] }> {
  const p = await pool();
  const r = await p.request().input('c', sql.Int, idCompany).query(`
    SELECT d.id, d.doc_entry FROM dbo.sales_automation_doc d LEFT JOIN dbo.sales_authorization sa ON sa.id_request_general = d.id_request_general
    WHERE d.id_company = @c AND ${REPRESADO_SQL} ORDER BY d.id;`);
  const rows = r.recordset as { id: number; doc_entry: number }[];
  const resultados: { idDoc: number; docEntry: number; ok: boolean; detalle: string }[] = [];
  for (const row of rows.slice(0, MAX_REINTENTO_MASIVO)) {
    try {
      const x = await retryDoc(idCompany, row.id, usuario);
      resultados.push({ idDoc: row.id, docEntry: row.doc_entry, ok: x.ok, detalle: x.detalle });
    } catch (e) {
      resultados.push({ idDoc: row.id, docEntry: row.doc_entry, ok: false, detalle: friendly(e) });
    }
  }
  const ok = resultados.filter((x) => x.ok).length;
  return { total: resultados.length, ok, fallidos: resultados.length - ok, pendientes: Math.max(0, rows.length - resultados.length), resultados };
}

/** Datos del panel: KPIs, registro y corridas. */
export async function panelData(idCompany: number) {
  const p = await pool();
  const r = await p.request().input('c', sql.Int, idCompany).query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.sales_automation_doc WHERE id_company = @c AND estado = N'enviado' AND CAST(updated_at AS date) = CAST(sysutcdatetime() AS date)) AS enviados_hoy,
      (SELECT COUNT(*) FROM dbo.sales_automation_doc WHERE id_company = @c AND estado = N'error') AS con_error,
      (SELECT COUNT(*) FROM dbo.sales_automation_doc d LEFT JOIN dbo.sales_authorization sa ON sa.id_request_general = d.id_request_general
         WHERE d.id_company = @c AND ${REPRESADO_SQL}) AS represados,
      (SELECT COUNT(*) FROM dbo.sales_automation_doc WHERE id_company = @c AND estado = N'simulado') AS simulados,
      (SELECT COUNT(*) FROM dbo.sales_authorization sa WHERE sa.id_company = @c AND sa.status = N'pending'
         AND EXISTS (SELECT 1 FROM dbo.sales_automation_doc d WHERE d.id_company = sa.id_company AND d.doc_entry = sa.doc_entry)) AS en_flujo,
      (SELECT COUNT(*) FROM dbo.sales_authorization sa WHERE sa.id_company = @c AND sa.status = N'approved'
         AND EXISTS (SELECT 1 FROM dbo.sales_automation_doc d WHERE d.id_company = sa.id_company AND d.doc_entry = sa.doc_entry)) AS con_pedido;
    SELECT TOP 200 d.id, d.doc_entry, d.doc_num, d.card_code, d.card_name, d.doc_total, d.estado, d.destino, d.detalle, d.error,
           d.id_request_general, d.intentos, d.updated_at, sa.status AS estado_flujo, sa.order_doc_entry, sa.error AS error_flujo,
           ${ERROR_TAREA_SQL} AS error_tarea
    FROM dbo.sales_automation_doc d
    LEFT JOIN dbo.sales_authorization sa ON sa.id_request_general = d.id_request_general
    WHERE d.id_company = @c ORDER BY CASE WHEN ${REPRESADO_SQL} THEN 0 ELSE 1 END, d.updated_at DESC;
    SELECT TOP 50 id, origen, inicio, fin, simulacion, candidatos, enviados, simulados, errores, detalle
    FROM dbo.sales_automation_run WHERE id_company = @c ORDER BY inicio DESC;`);
  const sets = r.recordsets as unknown as Record<string, unknown>[][];
  const docs = sets[1].map((d) => ({ ...d, represado: represadoOf(d as Parameters<typeof represadoOf>[0]) }));
  return { kpis: sets[0][0], docs, runs: sets[2] };
}

/** job_type 'ventas_automatizar' (lib/scheduler/handlers.js). Payload: { id_company }. */
export async function runVentasAutomatizarJob(payload: { id_company?: unknown } | null): Promise<{ ref: string; detail: string }> {
  const id = Number(payload?.id_company);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Payload inválido: se requiere { id_company }.');
  const s = await runAutomation({ idCompany: id, origen: 'programada', modo: 'auto' });
  const detail = summaryText(s);
  if (!s.omitido && s.errores > 0 && s.enviados + s.simulados === 0) throw new Error(detail);
  return { ref: `ventas:${id}`, detail };
}
