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

export const DEFAULT_FIELD_WIDTH = 36;
export const DEFAULT_FIELD_HEIGHT = 16;
export const MIN_FIELD_WIDTH = 22;
export const MAX_FIELD_WIDTH = 55;
export const MIN_FIELD_HEIGHT = 12;
export const MAX_FIELD_HEIGHT = 36;

export function createFieldId(): string {
  return `sf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function clampFieldSize(field: SignatureFieldPlacement): SignatureFieldPlacement {
  return {
    ...field,
    width: clamp(field.width, MIN_FIELD_WIDTH, MAX_FIELD_WIDTH),
    height: clamp(field.height, MIN_FIELD_HEIGHT, MAX_FIELD_HEIGHT),
    x: clamp(field.x, 0, 100 - MIN_FIELD_WIDTH),
    y: clamp(field.y, 0, 100 - MIN_FIELD_HEIGHT),
  };
}
