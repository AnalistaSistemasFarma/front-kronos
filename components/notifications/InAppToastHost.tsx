'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ActionIcon, Avatar, Button, Textarea } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import {
  IconActivity,
  IconAlertTriangle,
  IconBell,
  IconListCheck,
  IconSend,
  IconShieldCheck,
  IconSignature,
  IconTicket,
  IconDeviceMobileVibration,
  IconX,
} from '@tabler/icons-react';
import { agentColor, agentInitials, chatFetch, notifyChatRefresh, pedirSondeoDelHilo } from '../../lib/chat/client';
import { MAX_USER_MESSAGE_CHARS } from '../../lib/chat/constants';
import { MAX_NOTE_REPLY_CHARS } from '../../lib/notifications/replyTarget';
import { isExternalNotificationPath } from '../../lib/notifications/resolveNotificationTarget';
import { TOAST_DURATION_MS, toastTimeLabel, type InAppToast } from '../../lib/notifications/inAppToast';
import {
  clearInAppToasts,
  dismissInAppToast,
  dismissMatchingSystemNotifications,
  getInAppToasts,
  getServerInAppToasts,
  subscribeInAppToasts,
} from '../../lib/notifications/inAppToastStore';
import { Z_INDEX } from '../../lib/ui/zIndex';
import styles from './InAppToastHost.module.css';

/**
 * Host of the in-app notification cards (lib/notifications/inAppToast.ts). Mounted once in the
 * header of the whole app, next to ChatPulse and the bell, and drawn in a portal above the page and
 * the floating chat panel but below any modal (lib/ui/zIndex.ts, so a card never covers the toolbar
 * of an open preview): top-right below the header on a computer, full width at the top on a phone (msg 38429:
 * the bottom-right corner collided with the floating chat panel). Max 3 cards, newest on top, ~8 s each (paused while the pointer, the
 * focus or a draft is on the card). Each card has an always-visible reply input when it has a
 * reply target (2026-11-24, msg 38376): Enter sends, Esc closes.
 */
export default function InAppToastHost() {
  const toasts = useSyncExternalStore(subscribeInAppToasts, getInAppToasts, getServerInAppToasts);
  const { status } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') clearInAppToasts();
  }, [status]);

  if (!mounted) return null;
  return createPortal(
    <section className={styles.region} style={{ zIndex: Z_INDEX.inAppToasts }} aria-live='polite' aria-label='Notificaciones de SynerLink'>
      {toasts.map((t) => (
        <ToastCard key={t.key} toast={t} />
      ))}
    </section>,
    document.body
  );
}

const ICONS = {
  bell: IconBell,
  signature: IconSignature,
  validation: IconShieldCheck,
  ticket: IconTicket,
  activity: IconListCheck,
  alert: IconAlertTriangle,
  nudge: IconDeviceMobileVibration,
} as const;

function ToastCard({ toast }: { toast: InAppToast }) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  // A new event for the same conversation replaces the card: the countdown starts over.
  const [revision, setRevision] = useState(0);
  const remainingRef = useRef(TOAST_DURATION_MS);
  const lastToastRef = useRef(toast);

  useEffect(() => {
    if (lastToastRef.current === toast) return;
    lastToastRef.current = toast;
    remainingRef.current = TOAST_DURATION_MS;
    setSent(null);
    setRevision((r) => r + 1);
  }, [toast]);

  // Never auto-dismiss while the person is writing (focus or a pending draft) or sending.
  const paused = hovered || focused || sending || draft.trim() !== '';

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => dismissInAppToast(toast.key), remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(800, remainingRef.current - (Date.now() - startedAt));
    };
  }, [paused, toast.key, revision]);

  const dismiss = useCallback(() => dismissInAppToast(toast.key), [toast.key]);

  const open = useCallback(() => {
    dismissInAppToast(toast.key);
    if (!toast.url) return;
    dismissMatchingSystemNotifications(toast.url);
    if (isExternalNotificationPath(toast.url)) window.location.assign(toast.url);
    else router.push(toast.url);
  }, [router, toast.key, toast.url]);

  const sendReply = useCallback(async () => {
    const text = draft.trim();
    const reply = toast.reply;
    if (!text || !reply || sending) return;
    setSending(true);
    setReplyError(null);
    try {
      const res =
        reply.kind === 'chat'
          ? await chatFetch(`/api/chat/conversations/${reply.conversationId}/messages`, {
              method: 'POST',
              body: JSON.stringify({ body: text }),
            })
          : await chatFetch(`/api/notifications/${reply.notificationId}/reply`, {
              method: 'POST',
              body: JSON.stringify({ body: text }),
            });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setReplyError(payload?.error || 'No se pudo enviar la respuesta.');
        return;
      }
      setDraft('');
      if (reply.kind === 'chat') {
        setSent('Respuesta enviada ✓');
        notifyChatRefresh();
        pedirSondeoDelHilo(reply.conversationId);
      } else {
        const data = (await res.json().catch(() => null)) as { kind?: string; targetId?: number } | null;
        setSent(
          data?.kind === 'ticket'
            ? `Nota agregada al ticket #${data.targetId} ✓`
            : `Nota agregada a la solicitud${data?.targetId ? ` #${data.targetId}` : ''} ✓`
        );
        // The notification was marked as read: the bell refreshes its counter.
        window.dispatchEvent(new Event('synerlink:notifications-refresh'));
      }
      dismissMatchingSystemNotifications(toast.url);
      // Leave the input so the card can close by itself a moment later.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setFocused(false);
      remainingRef.current = 2_500;
      setRevision((r) => r + 1);
    } catch {
      setReplyError('No se pudo enviar la respuesta. Revise su conexión.');
    } finally {
      setSending(false);
    }
  }, [draft, sending, toast.reply, toast.url]);

  const className = [
    styles.card,
    toast.tone === 'urgent' ? styles.urgent : '',
    toast.tone === 'nudge' ? styles.nudge : '',
    toast.emojiOnly ? styles.emojiCard : '',
    paused ? styles.paused : '',
  ]
    .filter(Boolean)
    .join(' ');

  const Icon = toast.icon ? ICONS[toast.icon] : IconActivity;
  const reducedMotion = useReducedMotion();

  return (
    <article
      className={className}
      role={toast.tone === 'urgent' ? 'alert' : 'status'}
      aria-label={`${toast.label ? `${toast.label}: ` : ''}${toast.title}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          dismiss();
        }
      }}
    >
      <div className={styles.head}>
        {toast.avatar ? (
          <Avatar
            src={toast.avatar.src || undefined}
            alt={toast.avatar.name}
            size={40}
            radius='xl'
            color={agentColor(toast.avatar.colorKey)}
          >
            {agentInitials(toast.avatar.name)}
          </Avatar>
        ) : (
          <span className={styles.iconBox} aria-hidden>
            <Icon size={22} stroke={1.8} />
          </span>
        )}
        <div className={styles.texts}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{toast.title}</span>
          </div>
          <div className={styles.meta}>
            {toast.label && <span className={styles.label}>{toast.label}</span>}
            {toast.company && <span className={styles.company}>{toast.company}</span>}
            <time dateTime={toast.createdAt}>{toastTimeLabel(toast.createdAt)}</time>
          </div>
          {toast.context && <span className={styles.context}>{toast.context}</span>}
        </div>
        <button type='button' className={styles.close} onClick={dismiss} aria-label='Cerrar notificación'>
          <IconX size={16} />
        </button>
      </div>

      {toast.media ? (
        <div className={styles.mediaBox}>
          {/* eslint-disable-next-line @next/next/no-img-element -- same-origin chat media, sized by CSS */}
          <img
            className={styles.media}
            src={reducedMotion && toast.media.poster ? toast.media.poster : toast.media.src}
            alt={toast.media.alt}
            loading='lazy'
          />
        </div>
      ) : toast.emojiOnly ? (
        <p key={revision} className={styles.emojiBig} aria-label={toast.preview ?? undefined}>
          {toast.emojiOnly}
        </p>
      ) : (
        toast.preview && <p className={styles.preview}>{toast.preview}</p>
      )}

      {toast.celebrate && !reducedMotion && <Confetti key={`confetti-${revision}`} />}

      {sent && (
        <span className={styles.replyOk} role='status'>
          {sent}
        </span>
      )}
      {replyError && (
        <span className={styles.replyError} role='alert'>
          {replyError}
        </span>
      )}

      {toast.reply && !sent && (
        <div className={styles.replyRow}>
          <Textarea
            className={styles.replyInput}
            aria-label={toast.reply.placeholder}
            placeholder={toast.reply.placeholder}
            autosize
            minRows={1}
            maxRows={4}
            size='sm'
            maxLength={toast.reply.kind === 'chat' ? MAX_USER_MESSAGE_CHARS : MAX_NOTE_REPLY_CHARS}
            value={draft}
            disabled={sending}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void sendReply();
              }
            }}
          />
          <ActionIcon
            size='lg'
            variant='filled'
            aria-label='Enviar'
            onClick={() => void sendReply()}
            loading={sending}
            disabled={!draft.trim()}
          >
            <IconSend size={16} />
          </ActionIcon>
        </div>
      )}

      {toast.url && (
        <div className={styles.actions}>
          <Button size='compact-sm' variant={toast.reply && !sent ? 'subtle' : 'filled'} onClick={open}>
            Abrir
          </Button>
        </div>
      )}

      <span
        key={revision}
        className={styles.progress}
        style={{ animationDuration: `${remainingRef.current}ms` }}
        aria-hidden
      />
    </article>
  );
}

/* Short confetti burst (~1 s) for celebration messages. CSS only, decorative, not focusable. */
const CONFETTI_COLORS = ['#f59f00', '#e64980', '#4c6ef5', '#12b886', '#fab005', '#7950f2'];
const CONFETTI_PIECES = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2;
  const distance = 60 + (i % 3) * 22;
  return {
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    dx: Math.round(Math.cos(angle) * distance),
    dy: Math.round(Math.sin(angle) * distance * 0.6),
    rotate: (i * 47) % 360,
    delay: (i % 4) * 40,
  };
});

function Confetti() {
  return (
    <span className={styles.confetti} aria-hidden>
      {CONFETTI_PIECES.map((p, i) => (
        <span
          key={i}
          className={styles.confettiPiece}
          style={
            {
              background: p.color,
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rotate}deg`,
              animationDelay: `${p.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
