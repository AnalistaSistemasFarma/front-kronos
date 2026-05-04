'use client';

import { ActionIcon, Indicator, Popover, ScrollArea, Switch, Tooltip, Loader } from '@mantine/core';
import { IconBell, IconBellRinging, IconCheck } from '@tabler/icons-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { usePushNotifications } from '../hooks/usePushNotifications';

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

export default function NotificationBell() {
  const { data: session } = useSession();
  const router = useRouter();
  const userEmail = session?.user?.email;
  const { isSupported, isSubscribed, permission, loading: pushLoading, subscribe, unsubscribe } =
    usePushNotifications(userEmail);

  const [opened, setOpened] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [fetching, setFetching] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!userEmail) return;
    setFetching(true);
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (err) {
      console.error('[NotificationBell] Error fetch:', err);
    } finally {
      setFetching(false);
    }
  }, [userEmail]);

  useEffect(() => {
    if (!userEmail) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [userEmail, fetchNotifications]);

  const handleClick = async (n: Notification) => {
    if (!n.read_at) {
      await fetch('/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: n.id }),
      });
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpened(false);
    if (n.url) router.push(n.url);
  };

  const markAllRead = async () => {
    await fetch('/api/notifications/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    setNotifications((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() }))
    );
    setUnreadCount(0);
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

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position='bottom-end'
      width={380}
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
        <div className='flex items-center justify-between px-4 py-2 border-b'>
          <span className='font-semibold text-sm'>Notificaciones</span>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className='flex items-center gap-1 text-xs text-blue-600 hover:underline'
            >
              <IconCheck size={14} /> Marcar todas
            </button>
          )}
        </div>

        <ScrollArea.Autosize mah={400}>
          {fetching && notifications.length === 0 ? (
            <div className='flex justify-center py-6'>
              <Loader size='sm' />
            </div>
          ) : notifications.length === 0 ? (
            <div className='py-6 text-center text-sm text-gray-500'>No tienes notificaciones</div>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`px-4 py-3 border-b cursor-pointer hover:bg-gray-50 ${
                    !n.read_at ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className='flex items-start gap-2'>
                    {!n.read_at && (
                      <span className='mt-1.5 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0' />
                    )}
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-medium truncate'>{n.title}</p>
                      <p className='text-xs text-gray-600 line-clamp-2'>{n.body}</p>
                      <p className='text-xs text-gray-400 mt-1'>{formatRelative(n.created_at)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea.Autosize>

        {isSupported && (
          <div className='px-4 py-2 border-t flex items-center justify-between bg-gray-50'>
            <span className='text-xs text-gray-700'>Notificaciones push</span>
            <Switch
              size='sm'
              checked={isSubscribed}
              onChange={togglePush}
              disabled={pushLoading || permission === 'denied'}
            />
          </div>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
