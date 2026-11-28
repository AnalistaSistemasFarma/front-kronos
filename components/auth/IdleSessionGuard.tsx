'use client';

import { useEffect, useRef } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { clearClientSessionArtifacts } from '../../lib/auth/logout';
import { SESSION_CLOSED_REASON, SESSION_IDLE_MINUTES, isIdle } from '../../lib/auth/sessionPolicy';

/** Shared across tabs: activity in any tab keeps the session open. */
export const LAST_ACTIVITY_STORAGE_KEY = 'synerlink:lastActivity';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
const CHECK_EVERY_MS = 30_000;
const WRITE_THROTTLE_MS = 15_000;

function readLastActivity(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Called by the login pages so a stale value from a previous session never closes a new one. */
export function clearLastActivity() {
  try {
    window.localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function writeLastActivity(at: number) {
  try {
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(at));
  } catch {
    /* storage blocked: the in-memory timer still works for this tab */
  }
}

/**
 * Closes the session after SESSION_IDLE_MINUTES without user activity in any tab
 * (URS-ACC-04, SGC validation). Background polling does not count as activity.
 * Also closes it on load when the last activity is already too old (tab reopened
 * after a long break).
 */
export default function IdleSessionGuard() {
  const { status } = useSession();
  const lastLocal = useRef<number>(Date.now());
  const closing = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const close = () => {
      if (closing.current) return;
      closing.current = true;
      clearLastActivity();
      clearClientSessionArtifacts();
      void signOut({ callbackUrl: `/login?motivo=${SESSION_CLOSED_REASON.idle}` });
    };

    const stored = readLastActivity();
    if (isIdle(stored)) {
      close();
      return;
    }
    const now = Date.now();
    lastLocal.current = now;
    writeLastActivity(now);

    let lastWrite = now;
    const onActivity = () => {
      const t = Date.now();
      lastLocal.current = t;
      if (t - lastWrite >= WRITE_THROTTLE_MS) {
        lastWrite = t;
        writeLastActivity(t);
      }
    };
    const check = () => {
      const shared = readLastActivity();
      const last = Math.max(lastLocal.current, shared ?? 0);
      if (isIdle(last)) close();
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [status]);

  return null;
}

