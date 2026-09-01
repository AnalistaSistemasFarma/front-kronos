import type { OrionSignerState } from './types';

export function isSignerCompleted(status?: string | null): boolean {
  const value = String(status || '').toUpperCase();
  return ['FIRMADO', 'SIGNED', 'COMPLETED'].includes(value);
}

export function isSignerRejected(status?: string | null): boolean {
  const value = String(status || '').toUpperCase();
  return ['RECHAZADO', 'REJECTED'].includes(value);
}

export function orderedSigners(signers?: OrionSignerState[] | null): OrionSignerState[] {
  return [...(signers ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getCurrentPendingSigner(signers?: OrionSignerState[] | null): OrionSignerState | null {
  for (const signer of orderedSigners(signers)) {
    if (!isSignerCompleted(signer.status) && !isSignerRejected(signer.status)) {
      return signer;
    }
  }
  return null;
}

export function allSignersCompleted(signers?: OrionSignerState[] | null): boolean {
  const list = orderedSigners(signers);
  return list.length > 0 && list.every((signer) => isSignerCompleted(signer.status));
}

export function newlyCompletedSigners(
  previous?: OrionSignerState[] | null,
  next?: OrionSignerState[] | null
): OrionSignerState[] {
  const prevByEmail = new Map<string, OrionSignerState>();
  for (const signer of orderedSigners(previous)) {
    const email = String(signer.email || '').trim().toLowerCase();
    if (email) prevByEmail.set(email, signer);
  }

  const completed: OrionSignerState[] = [];
  for (const signer of orderedSigners(next)) {
    const email = String(signer.email || '').trim().toLowerCase();
    if (!email || !isSignerCompleted(signer.status)) continue;
    const before = prevByEmail.get(email);
    if (!before || !isSignerCompleted(before.status)) {
      completed.push(signer);
    }
  }
  return completed;
}
