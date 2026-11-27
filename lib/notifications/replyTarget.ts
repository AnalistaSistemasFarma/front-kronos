/**
 * Where a quick reply to a BELL notification goes (2026-11-24, Nicolás Rivera, msg 38376: reply right
 * from the notification card). Pure: used by the card (show the input or only «Abrir») and by
 * POST /api/notifications/[id]/reply (which re-derives it from the stored URL, never from the client).
 *
 *   - Request   /process/request-general/view-request?id=N        → note on request N
 *   - Activity  /process/request-general/view-activities?id=T     → note on the request of task T
 *   - Ticket    /process/help-desk/view-ticket?id=N               → note on ticket (case) N
 *   - Anything else (alerts, SGC, SAPSEND…)                       → null: only «Abrir».
 */
export type NotificationReplyTarget =
  | { kind: 'request'; id: number }
  | { kind: 'task'; id: number; requestId: number | null }
  | { kind: 'ticket'; id: number };

function positiveInt(value: string | null): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

export function notificationReplyTarget(url: string | null | undefined): NotificationReplyTarget | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://local');
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/$/, '');
  const id = positiveInt(parsed.searchParams.get('id'));
  if (path === '/process/request-general/view-request' && id) return { kind: 'request', id };
  if (path === '/process/request-general/view-activities' && id) {
    return { kind: 'task', id, requestId: positiveInt(parsed.searchParams.get('requestId')) };
  }
  if (path === '/process/help-desk/view-ticket' && id) return { kind: 'ticket', id };
  return null;
}

/** Placeholder of the card input for that target (UI text, Spanish). */
export function replyPlaceholder(target: NotificationReplyTarget): string {
  if (target.kind === 'ticket') return `Agregar una nota al ticket #${target.id}…`;
  if (target.kind === 'request') return `Agregar una nota a la solicitud #${target.id}…`;
  return 'Agregar una nota a la solicitud…';
}

/** Max length of a note sent from the card. */
export const MAX_NOTE_REPLY_CHARS = 2_000;
