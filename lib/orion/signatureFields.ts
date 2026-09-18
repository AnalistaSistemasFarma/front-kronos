export type SignatureFieldKind = 'signature' | 'fingerprint' | 'validation';

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
  /** signature = rúbrica; fingerprint = huella; validation = Elaboró/Revisó (pequeña). */
  kind?: SignatureFieldKind;
};

/** Payload enviado a Orion (sin documentId). */
export type OrionSignatureFieldPayload = {
  id: string;
  signerOrder: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  kind?: SignatureFieldKind;
};

export const DEFAULT_FIELD_WIDTH = 36;
export const DEFAULT_FIELD_HEIGHT = 16;
export const DEFAULT_FIELD_X = 8;
export const DEFAULT_FIELD_Y = 78;

export const MIN_FIELD_WIDTH = 22;
export const MAX_FIELD_WIDTH = 55;
export const MIN_FIELD_HEIGHT = 12;
export const MAX_FIELD_HEIGHT = 36;

/** Tamaño por defecto para firmas de validación (Elaboró / Revisó). */
export const VALIDATION_FIELD_WIDTH = 16;
export const VALIDATION_FIELD_HEIGHT = 8;
export const FINGERPRINT_FIELD_WIDTH = 18;
export const FINGERPRINT_FIELD_HEIGHT = 22;

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
  return 'signature';
}

export function defaultSizeForKind(kind?: SignatureFieldKind | null): {
  width: number;
  height: number;
} {
  const k = normalizeFieldKind(kind);
  if (k === 'validation') return { width: VALIDATION_FIELD_WIDTH, height: VALIDATION_FIELD_HEIGHT };
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
  if (k === 'validation') return { minW: 10, maxW: 28, minH: 5, maxH: 14 };
  if (k === 'fingerprint') return { minW: 12, maxW: 28, minH: 14, maxH: 32 };
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

/** Convierte un rect DOM (% CSS, origen arriba-izquierda) al modelo Orion. */
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

export function toOrionSignatureFields(
  fields: SignatureFieldPlacement[]
): OrionSignatureFieldPayload[] {
  return normalizeFieldsForStorage(fields, '').map(({ documentId: _d, ...rest }) => rest);
}

export function parseEmbedTokenFromUrl(embedUrl: string | null | undefined): string | null {
  const raw = String(embedUrl || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const token = url.searchParams.get('token');
    return token?.trim() || null;
  } catch {
    const match = /[?&]token=([^&#]+)/i.exec(raw);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return match[1].trim();
    }
  }
}

export function mapOrionFieldsToPlacements(
  fields: OrionSignatureFieldPayload[] | undefined | null,
  documentId: string
): SignatureFieldPlacement[] {
  if (!fields?.length) return [];
  return fields.map((f) =>
    clampFieldSize({
      id: f.id || createFieldId(),
      documentId,
      signerOrder: f.signerOrder,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      label: f.label,
      kind: normalizeFieldKind(f.kind),
    })
  );
}
