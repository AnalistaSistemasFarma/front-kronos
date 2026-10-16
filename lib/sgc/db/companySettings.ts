import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { parseCompanyDomains } from '../dissemination/scope';
import { SgcError } from '../errors';
import { decodeLogoDataUrl, getLogoDataUrlError } from '../pdf/institutional';
import { isSgcEmailMode } from '../pendings';
import { copyConfigOf } from '../uncontrolledCopies';
import { sha256HexOf } from '../signature/record';
import type { SgcActor, SgcDb } from './catalogs';

/**
 * CONFIGURACIÓN GENERAL DE LA EMPRESA en el SGC (correcciones de Calidad OLP,
 * 2026-10-03), editable por Aseguramiento de Calidad con motivo:
 *   - logo de la empresa (encabezado institucional del PDF controlado);
 *   - dominios de correo de las personas de la empresa (la divulgación
 *     automática solo los incluye; otras personas, solo elegidas a mano);
 *   - umbral de avance de lectura que se avisa al creador y a Calidad.
 * Cada cambio queda en sgc.audit_log con el antes y el después (el logo, por
 * su huella SHA-256 y tamaño, no completo).
 */

/**
 * Sprint 8 (Calidad OLP, 2026-10-07: «que sea fijo, que no sea una opción»):
 * ¿el encabezado institucional es OBLIGATORIO en la empresa? Por defecto sí;
 * es configuración por empresa (sgc.company_config.header_mandatory) para
 * poder revertirlo sin tocar el código.
 */
export async function isHeaderMandatory(db: Pick<SgcDb, 'sgcCompanyConfig'>, idCompany: number): Promise<boolean> {
  const c = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { header_mandatory: true } });
  return c?.header_mandatory ?? true;
}

/**
 * Sprint 11 (bloqueo de capturas): ¿el visor lleva la protección (marca de
 * agua en mosaico, ocultar sin foco y registro de «Imprimir pantalla»)? Por
 * defecto sí; configurable por empresa (sgc.company_config.viewer_protection).
 */
export async function isViewerProtected(db: Pick<SgcDb, 'sgcCompanyConfig'>, idCompany: number | null | undefined): Promise<boolean> {
  if (!idCompany) return true;
  const c = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { viewer_protection: true, approver_list_enforced: true } });
  return c?.viewer_protection ?? true;
}

/**
 * Excepción de Calidad, punto 3 (RN 2026-10-13): «Calidad revisa lo que
 * elabora». Ajuste POR EMPRESA, APAGADO por defecto, que cambia Aseguramiento
 * de Calidad con motivo. SIN MIGRACIÓN: el valor vigente es el de la última
 * fila de sgc.config_change_log (solo inserción, protegida por trigger) con
 * esta acción; así cada cambio queda, además, en el control de cambios.
 */
export const SGC_QUALITY_SELF_REVIEW_ACTION = 'empresa.calidad_revisa_lo_que_elabora';

type ConfigLogReader = { sgcConfigChangeLog: Pick<SgcDb['sgcConfigChangeLog'], 'findFirst'> };

export function parseQualitySelfReview(afterJson: string | null | undefined): boolean {
  try {
    const v = JSON.parse(afterJson ?? 'null') as { qualitySelfReview?: unknown } | null;
    return v?.qualitySelfReview === true;
  } catch {
    return false;
  }
}

export async function isQualitySelfReviewEnabled(db: ConfigLogReader, idCompany: number): Promise<boolean> {
  const last = await db.sgcConfigChangeLog.findFirst({
    where: { entity: 'company_config', entity_id: String(idCompany), id_company: idCompany, action: SGC_QUALITY_SELF_REVIEW_ACTION },
    orderBy: { id_config_change: 'desc' },
    select: { after_json: true },
  });
  return parseQualitySelfReview(last?.after_json);
}

/**
 * S15 — más ajustes POR EMPRESA con el mismo patrón SIN MIGRACIÓN (última fila
 * de sgc.config_change_log con su acción; cada cambio queda en el control de
 * cambios y en la auditoría):
 *  - D16 · «Restringir la aprobación a los líderes autorizados por
 *    departamento» (DOC v7). APAGADO por defecto: Nicolás, 2026-10-13 14:44,
 *    «por ahora sin restricción, para activarla más adelante».
 *  - D18 · «Aseguramiento de Calidad cierra la capacitación» (DOC v7: el
 *    creador la prepara, la dicta y carga los resultados). ENCENDIDO por
 *    defecto: D18 sigue abierta y se conserva el cierre de Calidad de hoy.
 */
export const SGC_DEPARTMENT_LEADERS_ACTION = 'empresa.aprobacion_lideres_departamento';
export const SGC_TRAINING_CLOSE_ACTION = 'empresa.calidad_cierra_capacitacion';

interface SgcCompanyFlag {
  action: string;
  key: string;
  defaultValue: boolean;
}

export const SGC_COMPANY_FLAGS = {
  departmentLeaders: { action: SGC_DEPARTMENT_LEADERS_ACTION, key: 'enforced', defaultValue: false },
  trainingClosedByQuality: { action: SGC_TRAINING_CLOSE_ACTION, key: 'qualityCloses', defaultValue: true },
} as const satisfies Record<string, SgcCompanyFlag>;

export function parseCompanyFlag(afterJson: string | null | undefined, flag: SgcCompanyFlag): boolean {
  try {
    const v = JSON.parse(afterJson ?? 'null') as Record<string, unknown> | null;
    const x = v?.[flag.key];
    return typeof x === 'boolean' ? x : flag.defaultValue;
  } catch {
    return flag.defaultValue;
  }
}

export async function readCompanyFlag(db: ConfigLogReader, idCompany: number, flag: SgcCompanyFlag): Promise<boolean> {
  const last = await db.sgcConfigChangeLog.findFirst({
    where: { entity: 'company_config', entity_id: String(idCompany), id_company: idCompany, action: flag.action },
    orderBy: { id_config_change: 'desc' },
    select: { after_json: true },
  });
  return last ? parseCompanyFlag(last.after_json, flag) : flag.defaultValue;
}

/** D16: ¿la lista de líderes por departamento restringe la aprobación (DOC v7)? Apagado por defecto. */
export function isDepartmentLeaderListEnforced(db: ConfigLogReader, idCompany: number): Promise<boolean> {
  return readCompanyFlag(db, idCompany, SGC_COMPANY_FLAGS.departmentLeaders);
}

/** D18: ¿Aseguramiento de Calidad cierra la capacitación que dicta el creador (DOC v7)? Encendido por defecto. */
export function isTrainingClosedByQuality(db: ConfigLogReader, idCompany: number): Promise<boolean> {
  return readCompanyFlag(db, idCompany, SGC_COMPANY_FLAGS.trainingClosedByQuality);
}

export interface SgcCompanySettings {
  idCompany: number;
  hasLogo: boolean;
  logoDataUrl: string | null;
  disseminationDomains: string[] | null;
  readThresholdPct: number;
  /** Sprint 8: encabezado institucional obligatorio en documento nuevo y nueva versión. */
  headerMandatory: boolean;
  /** Sprint 8: carga inicial de vigentes (sin el encabezado del sistema) abierta o cerrada por Calidad. */
  initialLoad: { open: boolean; closedBy: string | null; closedAt: string | null; reason: string | null };
  /** Sprint 9: política de correo (nunca | vencimientos | resumen_diario). */
  emailMode: string;
  /** Sprint 11: copias no controladas (tipos, días por defecto y máximo) y protección del visor. */
  uncontrolledCopies: { types: string[]; days: number; maxDays: number };
  viewerProtection: boolean;
  /** Sprint 12: lista de aprobadores autorizados activa (aplica cuando hay al menos uno registrado). */
  approverListEnforced: boolean;
  /** Excepción de Calidad (2026-10-13, punto 3): Calidad puede revisar el documento que elaboró. Apagado por defecto. */
  qualitySelfReview: boolean;
  /** S15 (D16): la lista de líderes por departamento restringe la aprobación (DOC v7). Apagado por defecto. */
  approverDepartmentEnforced: boolean;
  /** S15 (D18): Aseguramiento de Calidad cierra la capacitación del creador (DOC v7). Encendido por defecto. */
  trainingClosedByQuality: boolean;
}

export async function getCompanySettings(db: SgcDb, idCompany: number): Promise<SgcCompanySettings> {
  const c = await db.sgcCompanyConfig.findUnique({
    where: { id_company: idCompany },
    select: { logo_data_url: true, dissemination_domains: true, read_threshold_pct: true, header_mandatory: true, initial_load_open: true, initial_load_closed_by: true, initial_load_closed_at: true, initial_load_close_reason: true, email_mode: true, uncontrolled_copy_types: true, uncontrolled_copy_days: true, uncontrolled_copy_max_days: true, viewer_protection: true, approver_list_enforced: true },
  });
  if (!c) throw new SgcError('La empresa no tiene el SGC activo.', 404);
  return {
    idCompany,
    hasLogo: Boolean(decodeLogoDataUrl(c.logo_data_url)),
    logoDataUrl: c.logo_data_url,
    disseminationDomains: parseCompanyDomains(c.dissemination_domains),
    readThresholdPct: c.read_threshold_pct,
    headerMandatory: c.header_mandatory,
    initialLoad: { open: c.initial_load_open, closedBy: c.initial_load_closed_by, closedAt: c.initial_load_closed_at?.toISOString() ?? null, reason: c.initial_load_close_reason },
    emailMode: c.email_mode,
    uncontrolledCopies: copyConfigOf(c),
    viewerProtection: c.viewer_protection,
    approverListEnforced: c.approver_list_enforced,
    qualitySelfReview: await isQualitySelfReviewEnabled(db, idCompany),
    approverDepartmentEnforced: await isDepartmentLeaderListEnforced(db, idCompany),
    trainingClosedByQuality: await isTrainingClosedByQuality(db, idCompany),
  };
}

function logoSummary(dataUrl: string | null): { bytes: number; sha256: string } | null {
  const d = decodeLogoDataUrl(dataUrl);
  if (!d) return null;
  return { bytes: d.bytes.length, sha256: sha256HexOf(d.bytes) };
}

export async function saveCompanySettings(db: SgcDb, idCompany: number, input: { logoDataUrl?: unknown; removeLogo?: unknown; disseminationDomains?: unknown; readThresholdPct?: unknown; emailMode?: unknown; uncontrolledCopyTypes?: unknown; uncontrolledCopyDays?: unknown; uncontrolledCopyMaxDays?: unknown; viewerProtection?: unknown; approverListEnforced?: unknown; qualitySelfReview?: unknown; approverDepartmentEnforced?: unknown; trainingClosedByQuality?: unknown; reason?: unknown }, actor: SgcActor): Promise<SgcCompanySettings> {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 10) throw new SgcError('Explique el motivo del cambio (mínimo 10 caracteres): queda en el control de cambios.');
  const current = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { logo_data_url: true, dissemination_domains: true, read_threshold_pct: true, email_mode: true, uncontrolled_copy_types: true, uncontrolled_copy_days: true, uncontrolled_copy_max_days: true, viewer_protection: true, approver_list_enforced: true } });
  if (!current) throw new SgcError('La empresa no tiene el SGC activo.', 404);
  const data: { logo_data_url?: string | null; dissemination_domains?: string | null; read_threshold_pct?: number; email_mode?: string; uncontrolled_copy_types?: string; uncontrolled_copy_days?: number; uncontrolled_copy_max_days?: number; viewer_protection?: boolean; approver_list_enforced?: boolean } = {};
  if (input.removeLogo === true) data.logo_data_url = null;
  else if (input.logoDataUrl !== undefined) {
    const err = getLogoDataUrlError(input.logoDataUrl);
    if (err) throw new SgcError(err);
    data.logo_data_url = String(input.logoDataUrl).trim();
  }
  if (input.disseminationDomains !== undefined) {
    const raw = Array.isArray(input.disseminationDomains) ? input.disseminationDomains.join(',') : String(input.disseminationDomains ?? '');
    const list = parseCompanyDomains(raw);
    if (raw.trim() && !list) throw new SgcError('Escriba dominios de correo válidos (p. ej. onelatampharma.com).');
    data.dissemination_domains = list ? list.join(',').slice(0, 500) : null;
  }
  if (input.readThresholdPct !== undefined) {
    const n = Number(input.readThresholdPct);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new SgcError('El umbral de avance de lectura debe ser un número entero entre 1 y 100.');
    data.read_threshold_pct = n;
  }
  // Sprint 9: política de correo de la empresa (por defecto «nunca»: solo campana y tablero).
  if (input.emailMode !== undefined && input.emailMode !== current.email_mode) {
    if (!isSgcEmailMode(input.emailMode)) throw new SgcError('Política de correo inválida (nunca, vencimientos o resumen_diario).');
    data.email_mode = input.emailMode;
  }
  // Sprint 11: copias no controladas (tipos permitidos, días por defecto y máximo) y protección del visor.
  if (input.uncontrolledCopyTypes !== undefined) {
    const codes = String(Array.isArray(input.uncontrolledCopyTypes) ? input.uncontrolledCopyTypes.join(',') : input.uncontrolledCopyTypes ?? '')
      .split(/[\s,;]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (!codes.length || codes.some((c) => !/^[A-Z0-9]{1,10}$/.test(c))) throw new SgcError('Indique los códigos de los tipos documentales que admiten copia no controlada (por ejemplo FO, FR).');
    const joined = [...new Set(codes)].join(',');
    if (joined !== (current.uncontrolled_copy_types ?? '')) data.uncontrolled_copy_types = joined.slice(0, 200);
  }
  const days = input.uncontrolledCopyDays === undefined ? current.uncontrolled_copy_days : Number(input.uncontrolledCopyDays);
  const maxDays = input.uncontrolledCopyMaxDays === undefined ? current.uncontrolled_copy_max_days : Number(input.uncontrolledCopyMaxDays);
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 365) throw new SgcError('El máximo de días de una copia no controlada debe estar entre 1 y 365.');
  if (!Number.isInteger(days) || days < 1 || days > maxDays) throw new SgcError('Los días por defecto de una copia no controlada deben estar entre 1 y el máximo.');
  if (days !== current.uncontrolled_copy_days) data.uncontrolled_copy_days = days;
  if (maxDays !== current.uncontrolled_copy_max_days) data.uncontrolled_copy_max_days = maxDays;
  if (typeof input.viewerProtection === 'boolean' && input.viewerProtection !== current.viewer_protection) data.viewer_protection = input.viewerProtection;
  if (typeof input.approverListEnforced === 'boolean' && input.approverListEnforced !== current.approver_list_enforced) data.approver_list_enforced = input.approverListEnforced;
  const selfReviewBefore = await isQualitySelfReviewEnabled(db, idCompany);
  const selfReviewChange = typeof input.qualitySelfReview === 'boolean' && input.qualitySelfReview !== selfReviewBefore ? input.qualitySelfReview : null;
  // S15: ajustes del DOC v7 (D16 y D18), sin migración.
  const flagChanges: { flag: SgcCompanyFlag; before: boolean; after: boolean }[] = [];
  for (const [field, flag] of [['approverDepartmentEnforced', SGC_COMPANY_FLAGS.departmentLeaders], ['trainingClosedByQuality', SGC_COMPANY_FLAGS.trainingClosedByQuality]] as const) {
    const raw = input[field];
    if (typeof raw !== 'boolean') continue;
    const before = await readCompanyFlag(db, idCompany, flag);
    if (raw !== before) flagChanges.push({ flag, before, after: raw });
  }
  if (Object.keys(data).length === 0 && selfReviewChange === null && flagChanges.length === 0) throw new SgcError('No hay cambios para guardar.');
  await db.$transaction(async (tx) => {
    await tx.sgcCompanyConfig.update({ where: { id_company: idCompany }, data: { ...data, updated_at: new Date() } });
    if (selfReviewChange !== null) {
      await tx.sgcConfigChangeLog.create({
        data: {
          id_company: idCompany,
          actor_email: actor.email,
          entity: 'company_config',
          entity_id: String(idCompany),
          action: SGC_QUALITY_SELF_REVIEW_ACTION,
          reason: reason.slice(0, 1000),
          before_json: JSON.stringify({ qualitySelfReview: selfReviewBefore }),
          after_json: JSON.stringify({ qualitySelfReview: selfReviewChange }),
          ip: actor.ip ?? null,
          user_agent: actor.userAgent ?? null,
        },
      });
    }
    for (const c of flagChanges) {
      await tx.sgcConfigChangeLog.create({
        data: {
          id_company: idCompany,
          actor_email: actor.email,
          entity: 'company_config',
          entity_id: String(idCompany),
          action: c.flag.action,
          reason: reason.slice(0, 1000),
          before_json: JSON.stringify({ [c.flag.key]: c.before }),
          after_json: JSON.stringify({ [c.flag.key]: c.after }),
          ip: actor.ip ?? null,
          user_agent: actor.userAgent ?? null,
        },
      });
    }
    const flagOf = (flag: SgcCompanyFlag) => flagChanges.find((c) => c.flag.action === flag.action);
    await writeSgcAudit(tx, {
      idCompany,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.empresaConfigurada,
      entity: 'company_config',
      entityId: idCompany,
      before: { logo: logoSummary(current.logo_data_url), disseminationDomains: current.dissemination_domains, readThresholdPct: current.read_threshold_pct, emailMode: current.email_mode, uncontrolledCopies: { types: current.uncontrolled_copy_types, days: current.uncontrolled_copy_days, maxDays: current.uncontrolled_copy_max_days }, viewerProtection: current.viewer_protection, approverListEnforced: current.approver_list_enforced, qualitySelfReview: selfReviewBefore, ...Object.fromEntries(flagChanges.map((c) => [c.flag.action, c.before])) },
      after: {
        logo: 'logo_data_url' in data ? logoSummary(data.logo_data_url ?? null) : logoSummary(current.logo_data_url),
        disseminationDomains: 'dissemination_domains' in data ? data.dissemination_domains : current.dissemination_domains,
        readThresholdPct: data.read_threshold_pct ?? current.read_threshold_pct,
        emailMode: data.email_mode ?? current.email_mode,
        uncontrolledCopies: { types: data.uncontrolled_copy_types ?? current.uncontrolled_copy_types, days, maxDays },
        viewerProtection: data.viewer_protection ?? current.viewer_protection,
        approverListEnforced: data.approver_list_enforced ?? current.approver_list_enforced,
        qualitySelfReview: selfReviewChange ?? selfReviewBefore,
        ...(flagOf(SGC_COMPANY_FLAGS.departmentLeaders) ? { [SGC_DEPARTMENT_LEADERS_ACTION]: flagOf(SGC_COMPANY_FLAGS.departmentLeaders)!.after } : {}),
        ...(flagOf(SGC_COMPANY_FLAGS.trainingClosedByQuality) ? { [SGC_TRAINING_CLOSE_ACTION]: flagOf(SGC_COMPANY_FLAGS.trainingClosedByQuality)!.after } : {}),
      },
      detail: reason.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  return getCompanySettings(db, idCompany);
}
