/**
 * Browser store of the in-app notification cards (see inAppToast.ts for the model and the rules).
 *
 * Module-level state, like lib/chat/message-sound.ts: the sources (chat pulse, chat inbox, bell)
 * live in different React trees and only need to push a card; the host subscribes with
 * useSyncExternalStore.
 */
import { addToStack, removeFromStack, samePage, type InAppToast } from './inAppToast';

let stack: InAppToast[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeInAppToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInAppToasts(): InAppToast[] {
  return stack;
}

const EMPTY: InAppToast[] = [];
export function getServerInAppToasts(): InAppToast[] {
  return EMPTY;
}

/** Is there a host mounted? Without it (login, public pages) nothing is queued. */
export function inAppToastsAvailable(): boolean {
  return listeners.size > 0;
}

/**
 * Shows a card. Skipped when the tab is hidden (the OS push covers that case) or when the person is
 * already on the page the card points to.
 */
export function showInAppToast(toast: InAppToast | null): boolean {
  if (!toast || typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!inAppToastsAvailable()) return false;
  if (document.visibilityState !== 'visible') return false;
  if (toast.url && samePage(`${window.location.pathname}${window.location.search}`, toast.url)) return false;
  stack = addToStack(stack, toast);
  emit();
  dismissMatchingSystemNotifications(toast.url);
  return true;
}

export function dismissInAppToast(key: string): void {
  const next = removeFromStack(stack, key);
  if (next.length === stack.length) return;
  stack = next;
  emit();
}

/** On sign-out: the next person starts clean. */
export function clearInAppToasts(): void {
  if (stack.length === 0) return;
  stack = [];
  emit();
}

/* ─────────────────────────── Avoiding the duplicate OS banner ─────────────────────────── */

/**
 * The same event usually also arrives as a Web Push. The service worker MUST show every push it
 * receives (Safari/iOS revoke the subscription otherwise, and Chrome shows a generic one), so the
 * push is never dropped there. What is safe: once the card is on screen and the window has focus,
 * close the OS notification that was already shown for the same link. A push that arrives a moment
 * later is caught by a second pass. Nothing is closed when the window has no focus.
 */
const SECOND_PASS_MS = 4_000;

export function dismissMatchingSystemNotifications(url: string | null): void {
  if (!url || typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  const pass = async () => {
    try {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || typeof registration.getNotifications !== 'function') return;
      const shown = await registration.getNotifications();
      for (const n of shown) {
        const target = (n.data as { url?: string } | null)?.url;
        if (samePage(target, url, window.location.origin)) n.close();
      }
    } catch {
      /* best effort: leaving the OS notification is harmless */
    }
  };
  void pass();
  window.setTimeout(() => void pass(), SECOND_PASS_MS);
}
