/**
 * IN-APP NOTIFICATION CARDS (2026-11-24, Nicolás Rivera, SynerLink conv. 1 msg 38312: «opción 1»).
 *
 * While SynerLink is open, new chat/project messages and new bell notifications show up as cards
 * drawn by SynerLink itself (like Teams' built-in notifications): avatar, title, company badge,
 * context line, short preview, time, an accent for urgent categories, and «Abrir» / «Responder».
 *
 * This file is PURE (no React, no network): the card model, the stack rules and the builders that
 * turn what the app already receives (inbox, pulse, bell) into cards. The store and the host live
 * in inAppToastStore.ts and components/notifications/InAppToastHost.tsx.
 *
 * No new realtime channel and no new LLM call: the sources are the chat pulse (long-poll), the
 * chat inbox and the bell's 30 s poll.
 */
import { notificationKind } from './notificationKind';
import { inferNotificationPath } from './resolveNotificationTarget';
import { notificationReplyTarget, replyPlaceholder } from './replyTarget';

/** 'urgent' = signatures/validations and monitor alerts; 'nudge' = 📳 between people. */
export type InAppToastTone = 'default' | 'urgent' | 'nudge';

export interface InAppToast {
  /** One card per key: a new event with the same key replaces the card (same conversation). */
  key: string;
  title: string;
  /** Small category label next to the time: «Proyecto», «Firma», «Alerta»… */
  label: string | null;
  /** Project / request / conversation the event belongs to. */
  context: string | null;
  preview: string | null;
  company: string | null;
  avatar: { src: string | null; name: string; colorKey: string } | null;
  /** Icon shown when there is no avatar (bell notifications). */
  icon: 'bell' | 'signature' | 'validation' | 'ticket' | 'activity' | 'alert' | 'nudge' | null;
  tone: InAppToastTone;
  createdAt: string;
  /** Where «Abrir» goes. null = no button. */
  url: string | null;
  /**
   * Inline quick reply (2026-11-24, msg 38376): a chat/project conversation (message via the chat
   * send API) or a bell notification (note on its request/ticket via /api/notifications/:id/reply).
   * null = only «Abrir».
   */
  reply: InAppToastReply | null;
}

export type InAppToastReply =
  | { kind: 'chat'; conversationId: number; placeholder: string }
  | { kind: 'notification'; notificationId: number; placeholder: string };

function chatReply(conversationId: number, placeholder = 'Responder…'): InAppToastReply {
  return { kind: 'chat', conversationId, placeholder };
}

/** At most this many cards on screen; the oldest leaves first. */
export const MAX_VISIBLE_TOASTS = 3;
/** Auto-dismiss after this long (paused while the pointer or focus is on the card). */
export const TOAST_DURATION_MS = 8_000;
/** Bell: more new notifications than this in one poll become a single summary card. */
export const BELL_BURST_LIMIT = 3;

/** Newest on top, one card per key, at most `max`. */
export function addToStack(stack: InAppToast[], toast: InAppToast, max = MAX_VISIBLE_TOASTS): InAppToast[] {
  return [toast, ...stack.filter((t) => t.key !== toast.key)].slice(0, Math.max(1, max));
}

export function removeFromStack(stack: InAppToast[], key: string): InAppToast[] {
  return stack.filter((t) => t.key !== key);
}

/** «Ahora», «Hace 3 min»… same wording as the bell. */
export function toastTimeLabel(createdAt: string, now = Date.now()): string {
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return '';
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return 'Ahora';
  if (min < 60) return `Hace ${min} min`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `Hace ${hr} h` : new Date(t).toLocaleDateString('es-CO');
}

function clip(text: string | null | undefined, max = 160): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/* ───────────────────────── Chat inbox (agents, groups, people) ───────────────────────── */

/** The slice of ChatConversationDto (lib/chat/client.ts) the card needs. */
export interface InboxConversationInput {
  id: number;
  kind?: string;
  title: string | null;
  agent: { idAgent: number; code: string; displayName: string; avatarUrl: string | null };
  company?: { companyName: string } | null;
  participants?: { kind: 'user' | 'agent'; id: string | number; name: string; avatarUrl: string | null }[] | null;
  lastMessage: { id: number; role: string; preview: string; createdAt: string } | null;
  unreadCount: number;
}

/**
 * Card for a conversation whose unread count just went up.
 * `agentAvatar` resolves the agent picture with the access catalog (uploaded photo version).
 */
export function toastFromInboxConversation(
  c: InboxConversationInput,
  myUserId: string | null | undefined,
  agentAvatar: (agent: InboxConversationInput['agent']) => string | null
): InAppToast | null {
  if (!c.lastMessage) return null;
  const preview = clip(c.lastMessage.preview) ?? 'Envió un archivo';
  const more = c.unreadCount > 1 ? ` (${c.unreadCount} nuevos)` : '';

  if (c.kind === 'people') {
    const people = (c.participants ?? []).filter((p) => p.kind === 'user');
    const other = people.find((p) => String(p.id) !== String(myUserId ?? '')) ?? people[0] ?? null;
    const name = other?.name?.trim() || 'Una persona';
    return {
      key: `chat-${c.id}`,
      title: name,
      label: 'Mensaje',
      context: `Mensaje directo${more}`,
      preview,
      company: null,
      avatar: { src: other?.avatarUrl ?? null, name, colorKey: `user-${other?.id ?? c.id}` },
      icon: null,
      tone: 'default',
      createdAt: c.lastMessage.createdAt,
      url: `/process/chat/persona/${c.id}`,
      reply: chatReply(c.id),
    };
  }

  if (c.kind === 'group') {
    const groupTitle = c.title?.trim() || 'Grupo';
    return {
      key: `chat-${c.id}`,
      title: groupTitle,
      label: 'Grupo',
      context: `Grupo con ${c.agent.displayName}${more}`,
      preview,
      company: c.company?.companyName ?? null,
      avatar: { src: agentAvatar(c.agent), name: c.agent.displayName, colorKey: c.agent.code },
      icon: null,
      tone: 'default',
      createdAt: c.lastMessage.createdAt,
      url: `/process/chat/grupo/${c.id}`,
      reply: chatReply(c.id),
    };
  }

  // Direct thread with an agent (no `kind` = before groups existed = direct).
  return {
    key: `chat-${c.id}`,
    title: c.agent.displayName,
    label: 'Asistente',
    context: `${c.title?.trim() || 'Conversación'}${more}`,
    preview,
    company: null,
    avatar: { src: agentAvatar(c.agent), name: c.agent.displayName, colorKey: c.agent.code },
    icon: null,
    tone: 'default',
    createdAt: c.lastMessage.createdAt,
    url: `/process/chat/${encodeURIComponent(c.agent.code)}`,
    reply: chatReply(c.id),
  };
}

/* ───────────────────────────── Project messages (pulse) ───────────────────────────── */

export interface ProjectPulseInput {
  idConversation: number;
  idMessage: number;
  authorName: string;
  createdAt: string;
  muted: boolean;
  preview?: string;
  projectName?: string;
  companyName?: string | null;
  authorAvatarUrl?: string | null;
  authorAgentCode?: string | null;
  url?: string;
}

/** Card for a new message in a project conversation. Muted projects (#1095) get none. */
export function toastFromProjectEvent(e: ProjectPulseInput): InAppToast | null {
  if (e.muted) return null;
  const project = e.projectName?.trim() || 'Proyecto';
  return {
    key: `chat-${e.idConversation}`,
    title: e.authorName || 'Alguien',
    label: 'Proyecto',
    context: project,
    preview: clip(e.preview) ?? null,
    company: e.companyName ?? null,
    avatar: {
      src: e.authorAvatarUrl ?? null,
      name: e.authorName || 'Alguien',
      colorKey: e.authorAgentCode || `author-${e.authorName}`,
    },
    icon: null,
    tone: 'default',
    createdAt: e.createdAt,
    url: e.url ?? '/process/proyectos',
    reply: chatReply(e.idConversation, 'Responder en el proyecto…'),
  };
}

/* ─────────────────────────────── Nudge (pulse) ─────────────────────────────── */

export function toastFromNudge(e: { idConversation: number; authorName: string; createdAt: string }): InAppToast {
  return {
    key: `nudge-${e.idConversation}`,
    title: e.authorName || 'Alguien',
    label: 'Zumbido',
    context: 'Le envió un zumbido 📳',
    preview: null,
    company: null,
    avatar: null,
    icon: 'nudge',
    tone: 'nudge',
    createdAt: e.createdAt,
    url: `/process/chat/persona/${e.idConversation}`,
    reply: chatReply(e.idConversation),
  };
}

/* ─────────────────────────────── Bell notifications ─────────────────────────────── */

export interface BellNotificationInput {
  id: number;
  title: string;
  body: string;
  url: string | null;
  created_at: string;
}

/** Monitor alerts (system and SAP) link to the metrics page. */
export function isMonitorAlert(n: { url: string | null }): boolean {
  return (n.url ?? '').toLowerCase().includes('/process/system-metrics');
}

/** Requests, activities and tickets accept a note; anything else only «Abrir». */
function bellReply(n: BellNotificationInput): InAppToastReply | null {
  const target = notificationReplyTarget(n.url);
  return target ? { kind: 'notification', notificationId: n.id, placeholder: replyPlaceholder(target) } : null;
}

export function toastFromBellNotification(n: BellNotificationInput): InAppToast {
  const kind = notificationKind(n.title, n.url);
  const alert = isMonitorAlert(n);
  const urgent = alert || kind.kind === 'firma' || kind.kind === 'validacion';
  const icon: InAppToast['icon'] = alert
    ? 'alert'
    : kind.kind === 'firma'
      ? 'signature'
      : kind.kind === 'validacion'
        ? 'validation'
        : kind.kind === 'ticket'
          ? 'ticket'
          : kind.kind === 'actividad'
            ? 'activity'
            : 'bell';
  const label = alert
    ? 'Alerta'
    : (kind.label ?? (kind.kind === 'ticket' ? 'Mesa de ayuda' : kind.kind === 'actividad' ? 'Actividad' : 'Notificación'));
  return {
    key: `bell-${n.id}`,
    title: clip(n.title, 90) ?? 'SynerLink',
    label,
    context: null,
    preview: clip(n.body, 200),
    company: null,
    avatar: null,
    icon,
    tone: urgent ? 'urgent' : 'default',
    createdAt: n.created_at,
    url: inferNotificationPath(n) ?? null,
    reply: bellReply(n),
  };
}

/**
 * New bell notifications since the last poll. The first poll only sets the baseline (`lastSeenId`
 * null): the history does not pop up. Returns the new ones, newest first, and the new baseline.
 */
export function newBellNotifications<T extends { id: number }>(
  lastSeenId: number | null,
  unread: T[]
): { fresh: T[]; lastSeenId: number } {
  const maxId = unread.reduce((m, n) => Math.max(m, n.id), lastSeenId ?? 0);
  if (lastSeenId === null) return { fresh: [], lastSeenId: maxId };
  const fresh = unread.filter((n) => n.id > lastSeenId).sort((a, b) => b.id - a.id);
  return { fresh, lastSeenId: maxId };
}

/** Summary card when a single poll brings a burst of bell notifications. */
export function bellSummaryToast(count: number, newestAt: string, anyUrgent: boolean): InAppToast {
  return {
    key: 'bell-summary',
    title: `Tiene ${count} notificaciones nuevas`,
    label: 'Notificaciones',
    context: null,
    preview: 'Ábralas en la campana de la parte superior.',
    company: null,
    avatar: null,
    icon: 'bell',
    tone: anyUrgent ? 'urgent' : 'default',
    createdAt: newestAt,
    url: null,
    reply: null,
  };
}

/** Same page? Compares path + query of two app URLs (used to skip what is already on screen). */
export function samePage(a: string | null | undefined, b: string | null | undefined, origin = 'http://local'): boolean {
  if (!a || !b) return false;
  try {
    const ua = new URL(a, origin);
    const ub = new URL(b, origin);
    return ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '') && ua.search === ub.search;
  } catch {
    return false;
  }
}
