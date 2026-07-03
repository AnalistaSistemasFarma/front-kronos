'use client';

import {
  ActionIcon,
  Badge,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  SegmentedControl,
  Switch,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
  Loader,
} from '@mantine/core';
import {
  IconBell,
  IconBellRinging,
  IconCheck,
  IconChevronRight,
  IconClipboardList,
  IconListCheck,
  IconTicket,
} from '@tabler/icons-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { usePushNotifications } from '../hooks/usePushNotifications';
import {
  getNotificationActionLabel,
  inferNotificationPath,
  isExternalNotificationPath,
} from '../lib/notifications/resolveNotificationTarget';

interface Notification {
  id: number;
  title: string;
  body: string;
  url: string | null;
  read_at: string | null;
  created_at: string;
}

const POLL_INTERVAL_MS = 30_000;

function formatRelative(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Ahora';
  if (min < 60) return `Hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Hace ${hr} h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `Hace ${days} d`;
  return new Date(date).toLocaleDateString('es-CO');
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

function pickNotificationIcon(path: string | null, title: string) {
  const text = `${path ?? ''} ${title}`.toLowerCase();
  if (text.includes('ticket') || text.includes('view-ticket') || text.includes('mesa de ayuda')) {
    return IconTicket;
  }
  if (text.includes('actividad') || text.includes('view-activities')) {
    return IconListCheck;
  }
  return IconClipboardList;
}

export default function NotificationBell() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const userEmail = session?.user?.email;
  const isAuthenticated = status === 'authenticated' && Boolean(userEmail);
  const { isSupported, isSubscribed, permission, loading: pushLoading, subscribe, unsubscribe } =
    usePushNotifications(userEmail);

  const [opened, setOpened] = useState(false);
  // Lista de NO leídas: es la que alimenta el polling recurrente y el badge.
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [mounted, setMounted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fetchInFlightRef = useRef(false);

  // Vista activa en el dropdown y lista de leídas (se carga solo bajo demanda).
  const [view, setView] = useState<'unread' | 'read'>('unread');
  const [readNotifications, setReadNotifications] = useState<Notification[]>([]);
  const [readLoaded, setReadLoaded] = useState(false);
  const [fetchingRead, setFetchingRead] = useState(false);
  const readAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated || typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') return;
    if (fetchInFlightRef.current) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    fetchInFlightRef.current = true;
    setFetching(true);

    try {
      const res = await apiFetch('/api/notifications?status=unread', { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!res.ok) return;

      const data = await res.json();
      if (controller.signal.aborted) return;

      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return;
    } finally {
      fetchInFlightRef.current = false;
      if (!controller.signal.aborted) {
        setFetching(false);
      }
    }
  }, [isAuthenticated]);

  // Carga las leídas solo cuando el usuario lo pide (no entra en el polling).
  const fetchRead = useCallback(async () => {
    if (!isAuthenticated) return;

    readAbortRef.current?.abort();
    const controller = new AbortController();
    readAbortRef.current = controller;
    setFetchingRead(true);

    try {
      const res = await apiFetch('/api/notifications?status=read', { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!res.ok) return;

      const data = await res.json();
      if (controller.signal.aborted) return;

      setReadNotifications(data.notifications || []);
      setReadLoaded(true);
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return;
    } finally {
      if (!controller.signal.aborted) {
        setFetchingRead(false);
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const run = () => {
      void fetchNotifications();
    };

    const initialTimer = window.setTimeout(run, 800);
    const interval = window.setInterval(run, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchNotifications();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      abortRef.current?.abort();
    };
  }, [isAuthenticated, fetchNotifications]);

  useEffect(() => {
    if (opened && isAuthenticated) {
      // Siempre refresca las no leídas (mantiene el badge al día);
      // las leídas solo si esa es la vista activa y no se han cargado.
      void fetchNotifications();
      if (view === 'read' && !readLoaded) {
        void fetchRead();
      }
    }
  }, [opened, isAuthenticated, fetchNotifications, fetchRead, view, readLoaded]);

  useEffect(() => {
    return () => {
      readAbortRef.current?.abort();
    };
  }, []);

  const handleViewChange = useCallback(
    (next: string) => {
      const nextView = next === 'read' ? 'read' : 'unread';
      setView(nextView);
      if (nextView === 'read' && !readLoaded) {
        void fetchRead();
      }
    },
    [readLoaded, fetchRead]
  );

  const navigateToDetail = useCallback(
    (path: string) => {
      if (isExternalNotificationPath(path)) {
        window.location.assign(path);
        return;
      }

      // Evitar que view-ticket reutilice otro caso guardado en sessionStorage
      if (path.includes('/process/help-desk/view-ticket')) {
        const match = path.match(/[?&]id=(\d+)/);
        if (match?.[1]) {
          const targetId = Number(match[1]);
          try {
            const stored = sessionStorage.getItem('selectedTicket');
            if (stored) {
              const parsed = JSON.parse(stored) as { id_case?: number };
              if (parsed.id_case !== targetId) {
                sessionStorage.removeItem('selectedTicket');
                sessionStorage.removeItem('ticketsList');
              }
            }
          } catch {
            sessionStorage.removeItem('selectedTicket');
            sessionStorage.removeItem('ticketsList');
          }
        }
      }

      router.push(path);
    },
    [router]
  );

  const handleClick = async (n: Notification) => {
    const detailPath = inferNotificationPath(n);

    if (!detailPath) {
      toast.error('No hay enlace de detalle para esta notificación.');
      return;
    }

    if (!n.read_at) {
      try {
        await apiFetch('/api/notifications/read', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: n.id }),
        });
      } catch {
        /* no bloquear navegación */
      }
      // Sale de la lista de no leídas; la de leídas se recargará al verla.
      setNotifications((prev) => prev.filter((x) => x.id !== n.id));
      setUnreadCount((c) => Math.max(0, c - 1));
      setReadLoaded(false);
    }

    setOpened(false);
    navigateToDetail(detailPath);
  };

  const markAllRead = async () => {
    try {
      const res = await apiFetch('/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error('request failed');
    } catch {
      toast.error('No se pudieron marcar las notificaciones. Intenta de nuevo.');
      return;
    }
    // Todas pasan a leídas: se vacía la lista de no leídas y se invalida la de leídas.
    setNotifications([]);
    setUnreadCount(0);
    setReadLoaded(false);
    if (view === 'read') {
      void fetchRead();
    }
  };

  const togglePush = async () => {
    if (permission === 'denied') {
      toast.error('Permiso de notificaciones denegado en el navegador.', { duration: 5000 });
      return;
    }
    if (isSubscribed) {
      await unsubscribe();
      toast.success('Notificaciones push desactivadas');
    } else {
      await subscribe();
      if (Notification.permission === 'granted') {
        toast.success('Notificaciones push activadas');
      }
    }
  };

  if (!mounted || status === 'loading' || !isAuthenticated) {
    return (
      <ActionIcon variant='subtle' color='gray' aria-label='Notificaciones' disabled>
        <IconBell size={18} />
      </ActionIcon>
    );
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position='bottom-end'
      width={400}
      withArrow
      shadow='md'
    >
      <Popover.Target>
        <Indicator
          label={unreadCount > 99 ? '99+' : unreadCount}
          size={16}
          disabled={unreadCount === 0}
          color='red'
          offset={4}
        >
          <Tooltip label='Notificaciones' withArrow>
            <ActionIcon
              variant='subtle'
              color='gray'
              onClick={() => setOpened((o) => !o)}
              aria-label='Notificaciones'
            >
              {unreadCount > 0 ? <IconBellRinging size={18} /> : <IconBell size={18} />}
            </ActionIcon>
          </Tooltip>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify='space-between' px='md' py='sm' className='border-b border-[var(--app-border)]'>
          <Text size='sm' fw={600}>
            Notificaciones
          </Text>
          {unreadCount > 0 && (
            <UnstyledButton onClick={markAllRead}>
              <Group gap={4}>
                <IconCheck size={14} />
                <Text size='xs' c='blue'>
                  Marcar todas
                </Text>
              </Group>
            </UnstyledButton>
          )}
        </Group>

        <ScrollArea.Autosize mah={420}>
          {view === 'unread' ? (
            fetching && notifications.length === 0 ? (
              <Group justify='center' py='xl'>
                <Loader size='sm' />
              </Group>
            ) : notifications.length === 0 ? (
              <Text size='sm' c='dimmed' ta='center' py='xl'>
                No tienes notificaciones sin leer
              </Text>
            ) : (
              <ul className='list-none m-0 p-0'>
                {notifications.map((n) => (
                  <NotificationRow key={n.id} notification={n} onOpen={handleClick} />
                ))}
              </ul>
            )
          ) : fetchingRead && readNotifications.length === 0 ? (
            <Group justify='center' py='xl'>
              <Loader size='sm' />
            </Group>
          ) : notifications.length === 0 ? (
            <Text size='sm' c='dimmed' ta='center' py='xl'>
              No tienes notificaciones
            </Text>
          ) : (
            <ul className='list-none m-0 p-0'>
              {readNotifications.map((n) => (
                <NotificationRow key={n.id} notification={n} onOpen={handleClick} />
              ))}
            </ul>
          )}
        </ScrollArea.Autosize>

        {isSupported && (
          <Group
            justify='space-between'
            px='md'
            py='sm'
            className='notification-bell-footer border-t border-[var(--app-border)]'
          >
            <Text size='xs' className='notification-bell-text'>
              Notificaciones push
            </Text>
            <Switch
              size='sm'
              checked={isSubscribed}
              onChange={togglePush}
              disabled={pushLoading || permission === 'denied'}
            />
          </Group>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

function NotificationRow({
  notification: n,
  onOpen,
}: {
  notification: Notification;
  onOpen: (n: Notification) => void;
}) {
  const detailPath = inferNotificationPath(n);
  const actionLabel = getNotificationActionLabel(detailPath, n.title);
  const Icon = pickNotificationIcon(detailPath, n.title);
  const isUnread = !n.read_at;
  const hasLink = Boolean(detailPath);

  return (
    <li>
      <UnstyledButton
        onClick={() => onOpen(n)}
        disabled={!hasLink}
        w='100%'
        aria-label={hasLink ? `${actionLabel}: ${n.title}` : n.title}
        style={{
          display: 'block',
          opacity: hasLink ? 1 : 0.72,
          cursor: hasLink ? 'pointer' : 'default',
        }}
      >
        <Group
          gap='sm'
          wrap='nowrap'
          align='flex-start'
          px='md'
          py='sm'
          className={`notification-bell-row border-b border-[var(--app-border)] transition-colors ${
            isUnread ? 'notification-bell-row--unread' : ''
          } ${hasLink ? 'notification-bell-row--interactive' : ''}`}
        >
          <ThemeIcon
            size={36}
            radius='md'
            variant={isUnread ? 'light' : 'default'}
            color={isUnread ? 'blue' : 'gray'}
            style={{ flexShrink: 0 }}
          >
            <Icon size={18} />
          </ThemeIcon>

          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap={6} wrap='nowrap' mb={2}>
              {isUnread ? (
                <Badge size='xs' variant='dot' color='blue'>
                  Nueva
                </Badge>
              ) : null}
              <Text size='sm' fw={600} lineClamp={1} className='notification-bell-text' style={{ flex: 1 }}>
                {n.title}
              </Text>
            </Group>
            <Text size='xs' lineClamp={2} className='notification-bell-text-muted'>
              {n.body}
            </Text>
            <Group gap={6} mt={6} wrap='nowrap'>
              <Text size='xs' className='notification-bell-text-muted'>
                {formatRelative(n.created_at)}
              </Text>
              {hasLink ? (
                <>
                  <Text size='xs' className='notification-bell-text-muted'>
                    ·
                  </Text>
                  <Text size='xs' fw={600} lineClamp={1} className='notification-bell-accent'>
                    {actionLabel}
                  </Text>
                </>
              ) : null}
            </Group>
          </div>

          {hasLink ? (
            <ThemeIcon size='sm' variant='transparent' color='gray' style={{ flexShrink: 0, marginTop: 4 }}>
              <IconChevronRight size={16} />
            </ThemeIcon>
          ) : null}
        </Group>
      </UnstyledButton>
    </li>
  );
}
