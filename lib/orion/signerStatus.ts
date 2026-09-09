import type { OrionSignerState } from './types';

export function isSignerCompleted(status?: string | null): boolean {
  const value = String(status || '').toUpperCase();
  return ['FIRMADO', 'SIGNED', 'COMPLETED'].includes(value);
}

export function isSignerRejected(status?: string | null): boolean {
  const value = String(status || '').toUpperCase();
  return ['RECHAZADO', 'REJECTED'].includes(value);
}

export function normalizeSignerEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

export function orderedSigners(signers?: OrionSignerState[] | null): OrionSignerState[] {
  return [...(signers ?? [])]
    .map((signer, index) => ({ signer, index }))
    .sort((a, b) => {
      const orderA = a.signer.order ?? a.index + 1;
      const orderB = b.signer.order ?? b.index + 1;
      if (orderA !== orderB) return orderA - orderB;
      return a.index - b.index;
    })
    .map(({ signer }) => signer);
}

/** Clave estable por slot (permite el mismo email en varios órdenes). */
export function signerSlotKey(
  signer: { order?: number | null; email?: string | null },
  index = 0
): string {
  const order = Number(signer.order);
  if (Number.isFinite(order) && order > 0) return `o:${order}`;
  const email = normalizeSignerEmail(signer.email);
  return email ? `e:${email}:${index}` : `i:${index}`;
}

export function signersForEmail(
  signers: OrionSignerState[] | null | undefined,
  email?: string | null
): OrionSignerState[] {
  const me = normalizeSignerEmail(email);
  if (!me) return [];
  return orderedSigners(signers).filter((s) => normalizeSignerEmail(s.email) === me);
}

/** True si todas las apariciones del email ya están firmadas. */
export function allSlotsCompletedForEmail(
  signers: OrionSignerState[] | null | undefined,
  email?: string | null
): boolean {
  const mine = signersForEmail(signers, email);
  return mine.length > 0 && mine.every((s) => isSignerCompleted(s.status));
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
  const prevBySlot = new Map<string, OrionSignerState>();
  orderedSigners(previous).forEach((signer, index) => {
    prevBySlot.set(signerSlotKey(signer, index), signer);
  });

  const completed: OrionSignerState[] = [];
  orderedSigners(next).forEach((signer, index) => {
    if (!isSignerCompleted(signer.status)) return;
    const key = signerSlotKey(signer, index);
    const before = prevBySlot.get(key);
    if (!before || !isSignerCompleted(before.status)) {
      completed.push(signer);
    }
  });
  return completed;
}
