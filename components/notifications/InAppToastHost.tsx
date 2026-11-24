'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Avatar, Button, Textarea } from '@mantine/core';
import {
  IconActivity,
  IconAlertTriangle,
  IconBell,
  IconListCheck,
  IconShieldCheck,
  IconSignature,
  IconTicket,
  IconDeviceMobileVibration,
  IconX,
} from '@tabler/icons-react';
import { agentColor, agentInitials, chatFetch, notifyChatRefresh, pedirSondeoDelHilo } from '../../lib/chat/client';
import { MAX_USER_MESSAGE_CHARS } from '../../lib/chat/constants';
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
import styles from './InAppToastHost.module.css';

/**
 * Host of the in-app notification cards (lib/notifications/inAppToast.ts). Mounted once in the
 * header of the whole app, next to ChatPulse and the bell, and drawn in a portal on top of
 * everything: top-right on a computer, full width at the top on a phone. Max 3 cards, newest on
 * top, ~8 s each (paused while the pointer, the focus or a reply is on the card).
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
    <section className={styles.region} aria-live='polite' aria-label='Notificaciones de SynerLink'>
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
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // A new event for the same conversation replaces the card: the countdown starts over.
  const [revision, setRevision] = useState(0);
  const remainingRef = useRef(TOAST_DURATION_MS);
  const lastToastRef = useRef(toast);

  useEffect(() => {
    if (lastToastRef.current === toast) return;
    lastToastRef.current = toast;
    remainingRef.current = TOAST_DURATION_MS;
    setSent(false);
    setRevision((r) => r + 1);
  }, [toast]);

  const paused = hovered || focused || replying || sending;

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
    if (!text || toast.replyConversationId === null || sending) return;
    setSending(true);
    setReplyError(null);
    try {
      const res = await chatFetch(`/api/chat/conversations/${toast.replyConversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setReplyError(payload?.error || 'No se pudo enviar la respuesta.');
        return;
      }
      setDraft('');
      setReplying(false);
      setSent(true);
      notifyChatRefresh();
      pedirSondeoDelHilo(toast.replyConversationId);
      dismissMatchingSystemNotifications(toast.url);
      remainingRef.current = 1_800;
      setRevision((r) => r + 1);
    } catch {
      setReplyError('No se pudo enviar la respuesta. Revise su conexión.');
    } finally {
      setSending(false);
    }
  }, [draft, sending, toast.replyConversationId, toast.url]);

  const className = [
    styles.card,
    toast.tone === 'urgent' ? styles.urgent : '',
    toast.tone === 'nudge' ? styles.nudge : '',
    paused ? styles.paused : '',
  ]
    .filter(Boolean)
    .join(' ');

  const Icon = toast.icon ? ICONS[toast.icon] : IconActivity;

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

      {toast.preview && <p className={styles.preview}>{toast.preview}</p>}

      {sent && (
        <span className={styles.replyOk} role='status'>
          Respuesta enviada ✓
        </span>
      )}

      {replying ? (
        <div className={styles.replyBox}>
          <Textarea
            aria-label='Respuesta rápida'
            placeholder='Escriba su respuesta…'
            autosize
            minRows={1}
            maxRows={4}
            maxLength={MAX_USER_MESSAGE_CHARS}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void sendReply();
              }
            }}
          />
          {replyError && <span className={styles.replyError}>{replyError}</span>}
          <div className={styles.actions}>
            <Button
              size='compact-sm'
              variant='subtle'
              onClick={() => {
                setReplying(false);
                setReplyError(null);
              }}
            >
              Cancelar
            </Button>
            <Button size='compact-sm' onClick={() => void sendReply()} loading={sending} disabled={!draft.trim()}>
              Enviar
            </Button>
          </div>
        </div>
      ) : (
        (toast.url || toast.replyConversationId !== null) &&
        !sent && (
          <div className={styles.actions}>
            {toast.replyConversationId !== null && (
              <Button size='compact-sm' variant='light' onClick={() => setReplying(true)}>
                Responder
              </Button>
            )}
            {toast.url && (
              <Button size='compact-sm' onClick={open}>
                Abrir
              </Button>
            )}
          </div>
        )
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
