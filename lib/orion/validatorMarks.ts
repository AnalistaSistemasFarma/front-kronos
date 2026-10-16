import 'server-only';
import { loadOrionUserSignature } from './client';
import type { OrionSignatureState } from './types';
import { buildValidatorMarks, stampValidatorMarks } from './validatorStamp';

const SIGNATURE_CACHE_TTL_MS = 10 * 60 * 1000;
const signatureCache = new Map<string, { dataUrl: string | null; at: number }>();

async function loadSavedSignature(email: string): Promise<string | null> {
  const hit = signatureCache.get(email);
  if (hit && Date.now() - hit.at < SIGNATURE_CACHE_TTL_MS) return hit.dataUrl;
  const res = await loadOrionUserSignature(email).catch(() => null);
  if (!res?.ok) return hit?.dataUrl ?? null;
  const dataUrl = res.data?.dataUrl ?? null;
  signatureCache.set(email, { dataUrl, at: Date.now() });
  return dataUrl;
}

/**
 * Visto bueno de los validadores sobre el PDF que se sirve en SynerLink:
 * chulito mientras se firma; en la versión final (`final`), la firma guardada de
 * cada validador (sin firma guardada queda el chulito). Nunca lanza.
 */
export async function applyValidatorMarks(
  pdf: Uint8Array,
  state: OrionSignatureState,
  options: { final: boolean }
): Promise<Uint8Array> {
  const marks = buildValidatorMarks(state);
  if (marks.length === 0) return pdf;
  try {
    let signatures: Record<string, string | null> | undefined;
    if (options.final) {
      const entries = await Promise.all(
        marks.map(async (m) => [m.email, await loadSavedSignature(m.email)] as const)
      );
      signatures = Object.fromEntries(entries);
    }
    return await stampValidatorMarks(pdf, marks, signatures);
  } catch (err) {
    console.warn('[orion/validatorMarks] No se pudo estampar el visto bueno de validadores:', err);
    return pdf;
  }
}
