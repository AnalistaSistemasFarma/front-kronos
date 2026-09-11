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
};

export const DEFAULT_FIELD_WIDTH = 36;
export const DEFAULT_FIELD_HEIGHT = 16;
export const DEFAULT_FIELD_X = 8;
export const DEFAULT_FIELD_Y = 78;

export const MIN_FIELD_WIDTH = 22;
export const MAX_FIELD_WIDTH = 55;
export const MIN_FIELD_HEIGHT = 12;
export const MAX_FIELD_HEIGHT = 36;

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

export function clampFieldSize(field: SignatureFieldPlacement): SignatureFieldPlacement {
  const width = clamp(field.width, MIN_FIELD_WIDTH, MAX_FIELD_WIDTH);
  const height = clamp(field.height, MIN_FIELD_HEIGHT, MAX_FIELD_HEIGHT);
  return {
    ...field,
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
}): SignatureFieldPlacement {
  const { pageRect: pr, fieldRect: fr } = params;
  if (pr.width < 1 || pr.height < 1) {
    return clampFieldSize({
      id: params.id ?? createFieldId(),
      documentId: params.documentId,
      signerOrder: params.signerOrder,
      page: params.page,
      x: DEFAULT_FIELD_X,
      y: DEFAULT_FIELD_Y,
      width: DEFAULT_FIELD_WIDTH,
      height: DEFAULT_FIELD_HEIGHT,
      label: params.label,
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
    })
  );
}
