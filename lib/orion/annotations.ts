import { isSignerCompleted } from './signerStatus';
import type { OrionAnnotatedCopy, OrionDocumentAnnotation, OrionSignatureState } from './types';

/** Límites de los datos y sellos agregados después de firmar. */
export const ANNOTATION_MAX_ITEMS = 30;
export const ANNOTATION_MAX_TEXT = 200;
export const ANNOTATION_MAX_LABEL = 60;
export const ANNOTATION_MIN_SIZE = 1;
export const SEAL_MAX_BYTES = 2 * 1024 * 1024;
export const SEAL_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

export type AnnotationActor = { email: string; name?: string | null };

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Hay al menos una firma: desde ahí se pueden agregar datos y sellos. */
export function documentHasCompletedSignature(state: OrionSignatureState | null | undefined): boolean {
  return (state?.signers ?? []).some((s) => isSignerCompleted(s.status));
}

/** Este correo ya firmó (al menos uno de sus turnos) el documento. */
export function emailHasSigned(state: OrionSignatureState | null | undefined, email?: string | null): boolean {
  const me = normalizeEmail(email);
  if (!me) return false;
  return (state?.signers ?? []).some(
    (s) => normalizeEmail(s.email) === me && isSignerCompleted(s.status)
  );
}

/** Todas las firmas listas: desde aquí los datos de texto se guardan como copia "Datos N". */
export function documentFullySigned(state: OrionSignatureState | null | undefined): boolean {
  if (String(state?.status || '').toUpperCase() === 'FIRMADO') return true;
  const signers = state?.signers ?? [];
  return signers.length > 0 && signers.every((s) => isSignerCompleted(s.status));
}

/** Copia "Datos N" vigente (la de mayor número), o null. */
export function latestAnnotatedCopy(
  state: OrionSignatureState | null | undefined
): OrionAnnotatedCopy | null {
  const copies = (state?.annotatedCopies ?? []).filter((c) => c.oneDriveItemId);
  if (copies.length === 0) return null;
  return copies.reduce((best, c) => (c.round > best.round ? c : best));
}

/** Número, etiqueta y nombre de archivo de la siguiente copia "Datos N". */
export function nextAnnotatedCopyName(
  state: OrionSignatureState,
  now: Date = new Date()
): { id: string; round: number; label: string; fileName: string } {
  const round = (latestAnnotatedCopy(state)?.round ?? 0) + 1;
  const versionLabel = String(state.versionLabel || 'v1.0').trim() || 'v1.0';
  const stem = String(state.fileName || 'documento')
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|#%]+/g, '_')
    .trim()
    .slice(0, 120) || 'documento';
  return {
    id: `datos-${round}-${now.getTime()}`,
    round,
    label: `${versionLabel} · Datos ${round}`,
    fileName: `${stem} - ${versionLabel} datos ${round}.pdf`,
  };
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * Valida la lista que envía la pantalla y la deja lista para guardar. Conserva quién
 * creó cada elemento (no se confía en el cliente) y marca quién lo cambió.
 */
export function normalizeAnnotationsInput(
  input: unknown,
  previous: OrionDocumentAnnotation[] | null | undefined,
  actor: AnnotationActor,
  now: string = new Date().toISOString()
): OrionDocumentAnnotation[] {
  if (!Array.isArray(input)) throw httpError('Lista de datos inválida.', 400);
  if (input.length > ANNOTATION_MAX_ITEMS) {
    throw httpError(`Máximo ${ANNOTATION_MAX_ITEMS} datos o sellos por documento.`, 400);
  }
  const prevById = new Map((previous ?? []).map((a) => [a.id, a]));
  const seen = new Set<string>();
  const actorEmail = normalizeEmail(actor.email);
  const actorName = actor.name || null;

  return input.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const id = String(item.id || '').trim().slice(0, 60);
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || seen.has(id)) {
      throw httpError('Identificador de dato inválido.', 400);
    }
    seen.add(id);
    const kind = item.kind === 'seal' ? 'seal' : item.kind === 'text' ? 'text' : null;
    if (!kind) throw httpError('Tipo de dato inválido.', 400);

    const page = Math.floor(Number(item.page));
    const nums = [item.x, item.y, item.width, item.height].map(Number);
    if (!Number.isFinite(page) || page < 1 || nums.some((n) => !Number.isFinite(n))) {
      throw httpError('Posición del dato inválida.', 400);
    }
    const width = clamp(nums[2]!, ANNOTATION_MIN_SIZE, 100);
    const height = clamp(nums[3]!, ANNOTATION_MIN_SIZE, 100);
    const x = clamp(nums[0]!, 0, 100 - width);
    const y = clamp(nums[1]!, 0, 100 - height);

    let text: string | null = null;
    let label: string | null = null;
    let sealItemId: string | null = null;
    let sealFileName: string | null = null;
    if (kind === 'text') {
      text = String(item.text ?? '').replace(/[\r\n\t]+/g, ' ').trim();
      if (!text) throw httpError('Escriba el valor de cada dato (o quítelo).', 400);
      if (text.length > ANNOTATION_MAX_TEXT) {
        throw httpError(`Cada dato admite máximo ${ANNOTATION_MAX_TEXT} caracteres.`, 400);
      }
      label =
        String(item.label ?? '')
          .replace(/[\r\n\t]+/g, ' ')
          .trim()
          .slice(0, ANNOTATION_MAX_LABEL) || null;
    } else {
      sealItemId = String(item.sealItemId || '').trim();
      if (!sealItemId) throw httpError('Falta la imagen del sello.', 400);
      sealFileName = String(item.sealFileName || '').trim().slice(0, 120) || null;
    }

    const base = {
      id,
      kind,
      page,
      x: round2(x),
      y: round2(y),
      width: round2(width),
      height: round2(height),
      text,
      label,
      sealItemId,
      sealFileName,
    } as const;

    const prev = prevById.get(id);
    if (!prev) {
      return { ...base, createdByEmail: actorEmail, createdByName: actorName, createdAt: now };
    }
    const changed =
      prev.kind !== base.kind ||
      prev.page !== base.page ||
      prev.x !== base.x ||
      prev.y !== base.y ||
      prev.width !== base.width ||
      prev.height !== base.height ||
      (prev.text ?? null) !== base.text ||
      (prev.label ?? null) !== base.label ||
      (prev.sealItemId ?? null) !== base.sealItemId;
    return {
      ...base,
      createdByEmail: prev.createdByEmail,
      createdByName: prev.createdByName ?? null,
      createdAt: prev.createdAt,
      updatedByEmail: changed ? actorEmail : (prev.updatedByEmail ?? null),
      updatedByName: changed ? actorName : (prev.updatedByName ?? null),
      updatedAt: changed ? now : (prev.updatedAt ?? null),
    };
  });
}

function quote(text?: string | null): string {
  const value = String(text || '').trim();
  return `"${value.length > 60 ? `${value.slice(0, 57)}...` : value}"`;
}

/** `Tipo de cambio "4.123,45"` o solo `"4.123,45"` si el dato no tiene nombre. */
function named(a: OrionDocumentAnnotation, text?: string | null): string {
  return a.label ? `${a.label} ${quote(text)}` : quote(text);
}

/** Resumen para el historial de la solicitud; null si no cambió nada. */
export function describeAnnotationChanges(
  previous: OrionDocumentAnnotation[] | null | undefined,
  next: OrionDocumentAnnotation[]
): string | null {
  const prevById = new Map((previous ?? []).map((a) => [a.id, a]));
  const nextIds = new Set(next.map((a) => a.id));
  const parts: string[] = [];

  for (const item of next) {
    const prev = prevById.get(item.id);
    if (!prev) {
      parts.push(item.kind === 'text' ? `agregó ${named(item, item.text)}` : 'agregó un sello');
    } else if (item.kind === 'text' && (prev.text ?? '') !== (item.text ?? '')) {
      parts.push(`cambió ${named(item, prev.text)} por ${quote(item.text)}`);
    } else if (item.kind === 'text' && (prev.label ?? '') !== (item.label ?? '')) {
      parts.push(`llamó ${quote(item.text)} "${item.label || 'sin nombre'}"`);
    } else if (item.kind === 'seal' && prev.sealItemId !== item.sealItemId) {
      parts.push('cambió un sello');
    } else if (item.updatedAt && item.updatedAt !== prev.updatedAt) {
      parts.push(item.kind === 'text' ? `movió ${named(item, item.text)}` : 'movió un sello');
    }
  }
  for (const prev of previous ?? []) {
    if (!nextIds.has(prev.id)) {
      parts.push(prev.kind === 'text' ? `quitó ${named(prev, prev.text)}` : 'quitó un sello');
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}
