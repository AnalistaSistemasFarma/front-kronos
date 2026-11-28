import { describe, expect, it } from 'vitest';
import { isIdle, isLockedOut, isSessionExpired } from '../sessionPolicy';

describe('session policy (URS-ACC-04)', () => {
  const now = Date.UTC(2026, 10, 28, 12, 0, 0);

  it('expires a session only after the absolute lifetime', () => {
    const twelveHours = 12 * 3600;
    expect(isSessionExpired(now - 11 * 3600_000, now, twelveHours)).toBe(false);
    expect(isSessionExpired(now - 12 * 3600_000 - 1, now, twelveHours)).toBe(true);
  });

  it('ignores tokens without a valid sign-in time', () => {
    expect(isSessionExpired(undefined, now)).toBe(false);
    expect(isSessionExpired('yesterday', now)).toBe(false);
    expect(isSessionExpired(Number.NaN, now)).toBe(false);
  });

  it('locks the login at the failure threshold', () => {
    expect(isLockedOut(4, 5)).toBe(false);
    expect(isLockedOut(5, 5)).toBe(true);
    expect(isLockedOut(Number.NaN, 5)).toBe(false);
  });

  it('detects inactivity after the idle limit', () => {
    expect(isIdle(now - 14 * 60_000, now, 15)).toBe(false);
    expect(isIdle(now - 15 * 60_000 - 1, now, 15)).toBe(true);
    expect(isIdle(null, now, 15)).toBe(false);
  });
});
