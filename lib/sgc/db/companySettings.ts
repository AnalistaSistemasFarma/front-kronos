import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { parseCompanyDomains } from '../dissemination/scope';
import { SgcError } from '../errors';
import { decodeLogoDataUrl, getLogoDataUrlError } from '../pdf/institutional';
import { isSgcEmailMode } from '../pendings';
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
}

export async function getCompanySettings(db: SgcDb, idCompany: number): Promise<SgcCompanySettings> {
  const c = await db.sgcCompanyConfig.findUnique({
    where: { id_company: idCompany },
    select: { logo_data_url: true, dissemination_domains: true, read_threshold_pct: true, header_mandatory: true, initial_load_open: true, initial_load_closed_by: true, initial_load_closed_at: true, initial_load_close_reason: true, email_mode: true },
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
  };
}

function logoSummary(dataUrl: string | null): { bytes: number; sha256: string } | null {
  const d = decodeLogoDataUrl(dataUrl);
  if (!d) return null;
  return { bytes: d.bytes.length, sha256: sha256HexOf(d.bytes) };
}

export async function saveCompanySettings(db: SgcDb, idCompany: number, input: { logoDataUrl?: unknown; removeLogo?: unknown; disseminationDomains?: unknown; readThresholdPct?: unknown; emailMode?: unknown; reason?: unknown }, actor: SgcActor): Promise<SgcCompanySettings> {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 10) throw new SgcError('Explique el motivo del cambio (mínimo 10 caracteres): queda en el control de cambios.');
  const current = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { logo_data_url: true, dissemination_domains: true, read_threshold_pct: true, email_mode: true } });
  if (!current) throw new SgcError('La empresa no tiene el SGC activo.', 404);
  const data: { logo_data_url?: string | null; dissemination_domains?: string | null; read_threshold_pct?: number; email_mode?: string } = {};
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
  if (Object.keys(data).length === 0) throw new SgcError('No hay cambios para guardar.');
  await db.$transaction(async (tx) => {
    await tx.sgcCompanyConfig.update({ where: { id_company: idCompany }, data: { ...data, updated_at: new Date() } });
    await writeSgcAudit(tx, {
      idCompany,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.empresaConfigurada,
      entity: 'company_config',
      entityId: idCompany,
      before: { logo: logoSummary(current.logo_data_url), disseminationDomains: current.dissemination_domains, readThresholdPct: current.read_threshold_pct, emailMode: current.email_mode },
      after: {
        logo: 'logo_data_url' in data ? logoSummary(data.logo_data_url ?? null) : logoSummary(current.logo_data_url),
        disseminationDomains: 'dissemination_domains' in data ? data.dissemination_domains : current.dissemination_domains,
        readThresholdPct: data.read_threshold_pct ?? current.read_threshold_pct,
        emailMode: data.email_mode ?? current.email_mode,
      },
      detail: reason.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  return getCompanySettings(db, idCompany);
}
