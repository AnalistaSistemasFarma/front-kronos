import type { OrionSignatureState } from './types';

export function parseOrionSignatureState(raw: string | null | undefined): OrionSignatureState {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as OrionSignatureState;
  } catch {
    return {};
  }
}

export function serializeOrionSignatureState(state: OrionSignatureState): string {
  return JSON.stringify({
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

export function mergeOrionSignatureState(
  current: OrionSignatureState,
  patch: Partial<OrionSignatureState>
): OrionSignatureState {
  return {
    ...current,
    ...patch,
    signers: patch.signers ?? current.signers,
    updatedAt: new Date().toISOString(),
  };
}
