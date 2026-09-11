import type { OrionSignerState } from './types';

export function isSignerCompleted(status?: string | null): boolean {
  const value = String(status || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return [
    'FIRMADO',
    'SIGNED',
    'COMPLETED',
    'DONE',
    'APPLIED',
    'SIGNATURE_APPLIED',
    'SIGNED_OFF',
  ].includes(value);
}

/** Slot firmado: status terminal o signedAt (Orion a veces deja status viejo tras accept-sign). */
export function isSignerSlotCompleted(
  signer?: Pick<OrionSignerState, 'status' | 'signedAt'> | null
): boolean {
  if (!signer) return false;
  if (isSignerCompleted(signer.status)) return true;
  return Boolean(String(signer.signedAt || '').trim());
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
  return mine.length > 0 && mine.every((s) => isSignerSlotCompleted(s));
}

export function getCurrentPendingSigner(signers?: OrionSignerState[] | null): OrionSignerState | null {
  for (const signer of orderedSigners(signers)) {
    if (!isSignerSlotCompleted(signer) && !isSignerRejected(signer.status)) {
      return signer;
    }
  }
  return null;
}

export function allSignersCompleted(signers?: OrionSignerState[] | null): boolean {
  const list = orderedSigners(signers);
  return list.length > 0 && list.every((signer) => isSignerSlotCompleted(signer));
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
    if (!isSignerSlotCompleted(signer)) return;
    const key = signerSlotKey(signer, index);
    const before = prevBySlot.get(key);
    if (!before || !isSignerSlotCompleted(before)) {
      completed.push(signer);
    }
  });
  return completed;
}
