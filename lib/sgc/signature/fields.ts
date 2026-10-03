/**
 * UBICACIÓN DE FIRMAS EN EL DOCUMENTO — copia CONGELADA (2026-10-03) del
 * modelo de cajas de firma de SynerLink (lib/orion/signatureFields.ts, el
 * mecanismo con el que el usuario elige en el documento dónde firman las otras
 * personas). Se copió dentro del SGC porque el sistema validado no puede
 * depender en ejecución del código vivo de Orión/SynerLink (aislamiento
 * validado ante el INVIMA). Se conservan las mismas reglas de tamaño, límites
 * y conversión de coordenadas (porcentaje de la página, origen arriba a la
 * izquierda); se quitó lo que solo habla con la API de Orión (token de
 * inserción y formato de envío a Orión).
 *
 * Lo propio del SGC va al final: a quién pertenece cada caja (signerKey =
 * paso + persona o grupo, con su significado Elaboró/Revisó/Aprobó) y la
 * validación de lo que guarda el elaborador.
 */

export type SignatureFieldKind = 'signature' | 'fingerprint' | 'validation' | 'approval';

export type SignatureFieldPlacement = {
  id: string;
  documentId: string;
  signerOrder: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  /**
   * signature = rúbrica; fingerprint = huella; validation = Elaboró/Revisó (pequeña);
   * approval = validador del flujo. En el SGC todas las firmas usan la caja pequeña «validation».
   */
  kind?: SignatureFieldKind;
  /** Solo approval: validador dueño de la caja. */
  validatorEmail?: string | null;
};

/**
 * Las cajas de validadores comparten el editor con los firmantes: el validador n
 * usa signerOrder = VALIDATOR_ORDER_BASE + n para no chocar con los órdenes de firma.
 */
export const VALIDATOR_ORDER_BASE = 900;

export function validatorPlacementOrder(validatorOrder: number): number {
  return VALIDATOR_ORDER_BASE + validatorOrder;
}

export function isValidatorPlacementOrder(order: number): boolean {
  return order > VALIDATOR_ORDER_BASE;
}

export const DEFAULT_FIELD_WIDTH = 24;
export const DEFAULT_FIELD_HEIGHT = 12;
export const DEFAULT_FIELD_X = 8;
export const DEFAULT_FIELD_Y = 78;

export const MIN_FIELD_WIDTH = 14;
export const MAX_FIELD_WIDTH = 55;
export const MIN_FIELD_HEIGHT = 8;
export const MAX_FIELD_HEIGHT = 36;

/** Tamaño por defecto para firmas de validación (Elaboró / Revisó). */
export const VALIDATION_FIELD_WIDTH = 10;
export const VALIDATION_FIELD_HEIGHT = 5;
export const FINGERPRINT_FIELD_WIDTH = 12;
export const FINGERPRINT_FIELD_HEIGHT = 14;
export const APPROVAL_FIELD_WIDTH = 14;
export const APPROVAL_FIELD_HEIGHT = 5;

export function createFieldId(): string {
  return `sf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function roundPct(n: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

export function normalizeFieldKind(kind?: string | null): SignatureFieldKind {
  const raw = String(kind || '')
    .trim()
    .toLowerCase();
  if (raw === 'fingerprint' || raw === 'huella') return 'fingerprint';
  if (raw === 'validation' || raw === 'validacion' || raw === 'validación') return 'validation';
  if (raw === 'approval' || raw === 'validator' || raw === 'validador') return 'approval';
  return 'signature';
}

export function defaultSizeForKind(kind?: SignatureFieldKind | null): {
  width: number;
  height: number;
} {
  const k = normalizeFieldKind(kind);
  if (k === 'validation') return { width: VALIDATION_FIELD_WIDTH, height: VALIDATION_FIELD_HEIGHT };
  if (k === 'approval') return { width: APPROVAL_FIELD_WIDTH, height: APPROVAL_FIELD_HEIGHT };
  if (k === 'fingerprint') return { width: FINGERPRINT_FIELD_WIDTH, height: FINGERPRINT_FIELD_HEIGHT };
  return { width: DEFAULT_FIELD_WIDTH, height: DEFAULT_FIELD_HEIGHT };
}

export function sizeBoundsForKind(kind?: SignatureFieldKind | null): {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
} {
  const k = normalizeFieldKind(kind);
  if (k === 'validation') return { minW: 6, maxW: 28, minH: 3, maxH: 14 };
  if (k === 'approval') return { minW: 8, maxW: 30, minH: 3, maxH: 14 };
  if (k === 'fingerprint') return { minW: 8, maxW: 28, minH: 10, maxH: 32 };
  return {
    minW: MIN_FIELD_WIDTH,
    maxW: MAX_FIELD_WIDTH,
    minH: MIN_FIELD_HEIGHT,
    maxH: MAX_FIELD_HEIGHT,
  };
}

export function clampFieldSize(field: SignatureFieldPlacement): SignatureFieldPlacement {
  const kind = normalizeFieldKind(field.kind);
  const { minW, maxW, minH, maxH } = sizeBoundsForKind(kind);
  const width = clamp(field.width, minW, maxW);
  const height = clamp(field.height, minH, maxH);
  return {
    ...field,
    kind,
    width: roundPct(width),
    height: roundPct(height),
    x: roundPct(clamp(field.x, 0, 100 - width)),
    y: roundPct(clamp(field.y, 0, 100 - height)),
  };
}

/** Convierte un rect DOM (% CSS, origen arriba-izquierda) al modelo de cajas. */
export function fieldFromRect(params: {
  pageRect: DOMRect;
  fieldRect: DOMRect;
  signerOrder: number;
  page: number;
  documentId: string;
  id?: string;
  label?: string;
  kind?: SignatureFieldKind;
}): SignatureFieldPlacement {
  const { pageRect: pr, fieldRect: fr } = params;
  const kind = normalizeFieldKind(params.kind);
  const defaults = defaultSizeForKind(kind);
  if (pr.width < 1 || pr.height < 1) {
    return clampFieldSize({
      id: params.id ?? createFieldId(),
      documentId: params.documentId,
      signerOrder: params.signerOrder,
      page: params.page,
      x: DEFAULT_FIELD_X,
      y: DEFAULT_FIELD_Y,
      width: defaults.width,
      height: defaults.height,
      label: params.label,
      kind,
    });
  }

  return clampFieldSize({
    id: params.id ?? createFieldId(),
    documentId: params.documentId,
    signerOrder: params.signerOrder,
    page: params.page,
    x: ((fr.left - pr.left) / pr.width) * 100,
    y: ((fr.top - pr.top) / pr.height) * 100,
    width: (fr.width / pr.width) * 100,
    height: (fr.height / pr.height) * 100,
    label: params.label,
    kind,
  });
}

export function pctFromClientPoint(
  pageRect: DOMRect,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  if (pageRect.width < 1 || pageRect.height < 1) return null;
  return {
    x: ((clientX - pageRect.left) / pageRect.width) * 100,
    y: ((clientY - pageRect.top) / pageRect.height) * 100,
  };
}

export function normalizeFieldsForStorage(
  fields: SignatureFieldPlacement[],
  documentId: string
): SignatureFieldPlacement[] {
  return fields.map((f) =>
    clampFieldSize({
      ...f,
      documentId: f.documentId || documentId,
      page: Math.max(1, Math.floor(f.page)),
      signerOrder: Math.max(1, Math.floor(f.signerOrder)),
      kind: normalizeFieldKind(f.kind),
    })
  );
}

// ---------------------------------------------------------------------------
// Propio del SGC: dueño de cada caja y validación de lo que se guarda.
// ---------------------------------------------------------------------------

/** Significados de firma que se estampan en el documento (la lectura y la capacitación no). */
export type SgcPlacedMeaning = 'elaboro' | 'reviso' | 'aprobo';

/** Persona (o grupo) que firma el documento y cuya firma se ubica en él. */
export interface SgcPlacementParticipant {
  /** «elaboracion:correo», «revision:correo», «aprobacion:correo» o «aprobacion:grupo:CÓDIGO». */
  key: string;
  meaning: SgcPlacedMeaning;
  name: string;
  email: string;
  /** Rótulo del rol (Elaboró / Revisó / Aprobó). */
  role: string;
}

/** Caja guardada por el SGC (sgc.document_layout.fields_json). */
export interface SgcStoredField {
  id: string;
  signerKey: string;
  meaning: SgcPlacedMeaning;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string | null;
}

export const SGC_MAX_LAYOUT_FIELDS = 60;

/**
 * Tipo de caja que usa el SGC: «validation» (la caja PEQUEÑA de SynerLink para
 * Elaboró/Revisó, 6–28 % × 3–14 % de la página), para que la firma quepa en
 * los recuadros «Firma» del encabezado de la plantilla de Calidad.
 */
export const SGC_FIELD_KIND: SignatureFieldKind = 'validation';

export function sgcSignerKey(taskKey: string, email: string | null, poolTypeCode?: string | null): string {
  if (!email && poolTypeCode) return `${taskKey}:grupo:${poolTypeCode.trim().toUpperCase()}`;
  return `${taskKey}:${String(email ?? '').trim().toLowerCase()}`;
}

function finite(n: unknown): number | null {
  const v = typeof n === 'number' ? n : typeof n === 'string' && n.trim() !== '' ? Number(n) : NaN;
  return Number.isFinite(v) ? v : null;
}

/**
 * Valida y normaliza las cajas que envía el elaborador: solo de firmantes
 * actuales del documento, una por firmante (la última gana), página válida y
 * tamaño dentro de los límites de SynerLink. Devuelve el error en español.
 */
export function normalizeSgcFields(
  raw: unknown,
  participants: readonly SgcPlacementParticipant[],
  pageCount: number | null
): { fields: SgcStoredField[]; error: string | null } {
  if (!Array.isArray(raw)) return { fields: [], error: 'Las ubicaciones de firma son inválidas.' };
  if (raw.length > SGC_MAX_LAYOUT_FIELDS) return { fields: [], error: `Máximo ${SGC_MAX_LAYOUT_FIELDS} cajas de firma por documento.` };
  const byKey = new Map(participants.map((p) => [p.key, p]));
  const out = new Map<string, SgcStoredField>();
  for (const item of raw) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const signerKey = typeof r.signerKey === 'string' ? r.signerKey.trim() : '';
    const who = byKey.get(signerKey);
    if (!who) return { fields: [], error: 'Hay una caja de firma de una persona que ya no firma este documento: vuelva a abrir la ubicación de firmas.' };
    const page = finite(r.page);
    const [x, y, width, height] = [finite(r.x), finite(r.y), finite(r.width), finite(r.height)];
    if (page === null || x === null || y === null || width === null || height === null) return { fields: [], error: 'Una caja de firma tiene posición o tamaño inválidos.' };
    const p = Math.floor(page);
    if (p < 1 || (pageCount !== null && p > pageCount)) return { fields: [], error: `La caja de firma de ${who.name} está fuera del documento (página ${p}).` };
    const c = clampFieldSize({ id: 'x', documentId: '', signerOrder: 1, page: p, x, y, width, height, kind: SGC_FIELD_KIND });
    const id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.id) ? r.id : createFieldId();
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 200) || null : null;
    out.set(signerKey, { id, signerKey, meaning: who.meaning, page: p, x: c.x, y: c.y, width: c.width, height: c.height, label });
  }
  return { fields: [...out.values()], error: null };
}

/** Lee el JSON guardado (tolerante: lo inválido se descarta). */
export function parseStoredFields(json: string | null | undefined): SgcStoredField[] {
  try {
    const parsed = JSON.parse(json ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f): f is SgcStoredField => Boolean(f && typeof f === 'object' && typeof (f as SgcStoredField).signerKey === 'string' && Number.isFinite((f as SgcStoredField).page)));
  } catch {
    return [];
  }
}

/** Firmantes que aún no tienen caja ubicada. */
export function missingPlacements(participants: readonly SgcPlacementParticipant[], fields: readonly SgcStoredField[]): SgcPlacementParticipant[] {
  const placed = new Set(fields.map((f) => f.signerKey));
  return participants.filter((p) => !placed.has(p.key));
}

/** Caja del editor (orden numérico, como en SynerLink) ↔ caja guardada (signerKey). */
export function toPlacements(fields: readonly SgcStoredField[], participants: readonly SgcPlacementParticipant[], documentId: string): SignatureFieldPlacement[] {
  const order = new Map(participants.map((p, i) => [p.key, i + 1]));
  return fields
    .filter((f) => order.has(f.signerKey))
    .map((f) => ({ id: f.id, documentId, signerOrder: order.get(f.signerKey)!, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height, label: f.label ?? undefined, kind: SGC_FIELD_KIND }));
}

export function fromPlacements(placements: readonly SignatureFieldPlacement[], participants: readonly SgcPlacementParticipant[]): Omit<SgcStoredField, 'meaning'>[] {
  return placements
    .filter((p) => p.signerOrder >= 1 && p.signerOrder <= participants.length)
    .map((p) => ({ id: p.id, signerKey: participants[p.signerOrder - 1].key, page: p.page, x: p.x, y: p.y, width: p.width, height: p.height, label: p.label ?? null }));
}
