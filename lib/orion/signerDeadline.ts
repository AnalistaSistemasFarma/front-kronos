import { getCurrentPendingSigner, isSignerCompleted } from './signerStatus';
import type { OrionSignerState } from './types';

/** Plazo fijo por turno de firmante (horas). */
export const ORION_SIGNER_TURN_HOURS = 24;

export function addHoursIso(from: Date | string, hours: number): string {
  const base = typeof from === 'string' ? new Date(from) : from;
  const ms = Number.isNaN(base.getTime()) ? Date.now() : base.getTime();
  return new Date(ms + hours * 60 * 60 * 1000).toISOString();
}

export function isSignerTurnExpired(
  signer?: Pick<OrionSignerState, 'expiresAt'> | null,
  now: Date = new Date()
): boolean {
  const raw = String(signer?.expiresAt || '').trim();
  if (!raw) return false;
  const expires = new Date(raw);
  if (Number.isNaN(expires.getTime())) return false;
  return now.getTime() > expires.getTime();
}

export function remainingTurnMs(
  signer?: Pick<OrionSignerState, 'expiresAt'> | null,
  now: Date = new Date()
): number | null {
  const raw = String(signer?.expiresAt || '').trim();
  if (!raw) return null;
  const expires = new Date(raw);
  if (Number.isNaN(expires.getTime())) return null;
  return Math.max(0, expires.getTime() - now.getTime());
}

export function formatRemainingTurn(ms: number | null): string {
  if (ms == null) return '24 h';
  if (ms <= 0) return 'Vencido';
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours >= 48) {
    const days = Math.floor(hours / 24);
    return `${days} d`;
  }
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
}

/** Marca el turno del firmante pendiente con turnStartedAt / expiresAt (+24h). */
export function applyPendingSignerTurnDeadline(
  signers: OrionSignerState[] | undefined | null,
  now: Date = new Date()
): OrionSignerState[] {
  const list = [...(signers ?? [])];
  const pending = getCurrentPendingSigner(list);
  if (!pending) return list;
  const pendingEmail = String(pending.email || '')
    .trim()
    .toLowerCase();
  const started = now.toISOString();
  const expires = addHoursIso(now, ORION_SIGNER_TURN_HOURS);

  return list.map((s) => {
    const email = String(s.email || '')
      .trim()
      .toLowerCase();
    if (!email || email !== pendingEmail) {
      if (isSignerCompleted(s.status)) return s;
      // Otros pendientes: sin contador activo hasta su turno
      return { ...s, turnStartedAt: s.turnStartedAt ?? null, expiresAt: null };
    }
    return {
      ...s,
      turnStartedAt: started,
      expiresAt: expires,
      extensionRequestedAt: null,
    };
  });
}

export function renewPendingSignerDeadline(
  signers: OrionSignerState[] | undefined | null,
  now: Date = new Date()
): OrionSignerState[] {
  return applyPendingSignerTurnDeadline(signers, now);
}
