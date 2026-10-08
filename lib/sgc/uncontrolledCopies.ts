import { SgcError } from './errors';

/**
 * COPIAS NO CONTROLADAS (Sprint 11, socialización con Calidad OLP del
 * 2026-10-07; memoria rn-sgc-copias-no-controladas) — funciones PURAS.
 *
 * Una copia no controlada es la que sale de la compañía o se diligencia a
 * mano (por ejemplo, el formato de recolección de devoluciones que se envía a
 * un cliente). La compañía no responde por lo que se le haga; lo que SÍ se
 * controla es la solicitud y la autorización:
 *   - cualquier persona con acceso al documento la pide, con justificación,
 *     destino y días de vigencia;
 *   - decide SOLO el grupo exclusivo SGC-COPIA-NC (María Camila; nunca el jefe
 *     del área), siempre con motivo, y nadie decide su propia solicitud;
 *   - autorizada, se IMPRIME con la marca diagonal «COPIA NO CONTROLADA»,
 *     quién la pidió, quién la autorizó y hasta cuándo; vencido el plazo, ya
 *     no. Si el destino es un TERCERO también se puede bajar el PDF marcado
 *     (decisión D5). Cada impresión o descarga queda registrada.
 * Es una EXCEPCIÓN explícita a rn-sgc-ver-documento-sin-descarga.
 */

/** Tipo de autorización (grupo exclusivo) que decide las copias no controladas. */
export const SGC_AUTH_TYPE_UNCONTROLLED_COPY = 'SGC-COPIA-NC';

export const SGC_COPY_DESTINATIONS = ['interno', 'tercero'] as const;
export type SgcCopyDestination = (typeof SGC_COPY_DESTINATIONS)[number];
export const SGC_COPY_DESTINATION_LABELS: Record<SgcCopyDestination, string> = {
  interno: 'Uso interno (se diligencia a mano)',
  tercero: 'Se entrega a un tercero (cliente, proveedor…)',
};

export const SGC_COPY_STATUSES = ['pendiente', 'autorizada', 'rechazada', 'cancelada'] as const;
export type SgcCopyStatus = (typeof SGC_COPY_STATUSES)[number];
export const SGC_COPY_STATUS_LABELS: Record<SgcCopyStatus | 'vencida', string> = {
  pendiente: 'Pendiente de Calidad',
  autorizada: 'Autorizada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
  vencida: 'Vencida',
};

/** Valores por defecto (la empresa los cambia en sgc.company_config). */
export const SGC_COPY_DEFAULTS = { types: ['FO', 'FR'], days: 30, maxDays: 90 } as const;

export interface SgcCopyConfig {
  types: string[];
  days: number;
  maxDays: number;
}

/** Configuración de copias de la empresa (con los valores por defecto si faltan). */
export function copyConfigOf(row: { uncontrolled_copy_types?: string | null; uncontrolled_copy_days?: number | null; uncontrolled_copy_max_days?: number | null } | null): SgcCopyConfig {
  const types = (row?.uncontrolled_copy_types ?? '')
    .split(/[\s,;]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  return {
    types: types.length ? [...new Set(types)] : [...SGC_COPY_DEFAULTS.types],
    days: row?.uncontrolled_copy_days ?? SGC_COPY_DEFAULTS.days,
    maxDays: row?.uncontrolled_copy_max_days ?? SGC_COPY_DEFAULTS.maxDays,
  };
}

export interface SgcCopyRequestInput {
  justification: string;
  destination: SgcCopyDestination;
  destinationDetail: string | null;
  days: number;
}

/** Valida lo que pide la persona (justificación, destino y días). */
export function normalizeCopyRequest(raw: unknown, cfg: SgcCopyConfig): SgcCopyRequestInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const justification = typeof r.justification === 'string' ? r.justification.trim() : '';
  if (justification.length < 10) throw new SgcError('Explique para qué necesita la copia (mínimo 10 caracteres): queda en el historial.');
  if (justification.length > 1000) throw new SgcError('La justificación admite máximo 1.000 caracteres.');
  if (!(SGC_COPY_DESTINATIONS as readonly string[]).includes(String(r.destination))) throw new SgcError('Indique el destino de la copia: uso interno o un tercero.');
  const destination = r.destination as SgcCopyDestination;
  const detail = typeof r.destinationDetail === 'string' && r.destinationDetail.trim() ? r.destinationDetail.trim().slice(0, 300) : null;
  if (destination === 'tercero' && (!detail || detail.length < 3)) throw new SgcError('Indique a quién se entrega la copia (cliente, proveedor…).');
  const days = r.days === undefined || r.days === null || r.days === '' ? cfg.days : Number(r.days);
  if (!Number.isInteger(days) || days < 1 || days > cfg.maxDays) throw new SgcError(`Los días de vigencia de la copia deben estar entre 1 y ${cfg.maxDays}.`);
  return { justification, destination, destinationDetail: detail, days };
}

/** ¿El tipo documental admite copias no controladas en la empresa? */
export function copyAllowedForType(cfg: SgcCopyConfig, documentTypeCode: string): boolean {
  return cfg.types.includes(documentTypeCode.trim().toUpperCase());
}

/** Estado visible: una autorizada cuyo plazo pasó está «vencida». */
export function effectiveCopyStatus(status: string, expiresAt: Date | null, now: Date): SgcCopyStatus | 'vencida' {
  if (status === 'autorizada' && expiresAt && expiresAt.getTime() <= now.getTime()) return 'vencida';
  return (SGC_COPY_STATUSES as readonly string[]).includes(status) ? (status as SgcCopyStatus) : 'cancelada';
}

/** Vencimiento: fin del día (Colombia) del último día de vigencia. */
export function copyExpiry(from: Date, days: number): Date {
  const bogota = new Date(from.getTime() - 5 * 3600 * 1000);
  const end = Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), bogota.getUTCDate() + days, 23, 59, 59);
  return new Date(end + 5 * 3600 * 1000);
}

/** Qué se puede hacer con una copia (imprimir / bajar el PDF marcado). */
export function copyActions(copy: { status: string; expiresAt: Date | null; allowDownload: boolean }, now: Date): { canPrint: boolean; canDownload: boolean } {
  const active = effectiveCopyStatus(copy.status, copy.expiresAt, now) === 'autorizada';
  return { canPrint: active, canDownload: active && copy.allowDownload };
}

/** Eventos del VISOR que se registran en la auditoría (Sprint 11, bloqueo de capturas). */
export const SGC_VIEWER_EVENTS = ['imprimir_pantalla', 'copiar', 'imprimir_bloqueado'] as const;
export type SgcViewerEvent = (typeof SGC_VIEWER_EVENTS)[number];
export const SGC_VIEWER_EVENT_LABELS: Record<SgcViewerEvent, string> = {
  imprimir_pantalla: 'Intento de captura (tecla Imprimir pantalla)',
  copiar: 'Intento de copiar el contenido',
  imprimir_bloqueado: 'Intento de imprimir sin permiso',
};

/** Recurso del visor (ruta del archivo en /api/sgc/…) que se deja en la auditoría; null si no es válido. */
export function viewerResourceOf(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > 300 || !s.startsWith('/api/sgc/') || /[\s<>"']/.test(s)) return null;
  return s.split('?')[0];
}
