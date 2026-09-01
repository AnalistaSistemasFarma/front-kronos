'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  formatPushSubscribeError,
  isBenignPushError,
  isBrowserPushSupported,
  isPushFeatureEnabled,
  isSecureNotificationContext,
  isVapidConfigured,
  waitForServiceWorkerRegistration,
} from '../lib/push/client';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = typeof window !== 'undefined' ? window.atob(base64) : '';
  const outputArray = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) outputArray[i] = raw.charCodeAt(i);
  return outputArray.buffer as ArrayBuffer;
}

interface UsePushNotifications {
  isSupported: boolean;
  isAvailable: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission | 'default';
  loading: boolean;
  lastError: string | null;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
}

export function usePushNotifications(userEmail: string | null | undefined): UsePushNotifications {
  const [isSupported, setIsSupported] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'default'>('default');
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const supported = isBrowserPushSupported();
    setIsSupported(supported);
    setIsAvailable(isPushFeatureEnabled());

    if (!supported) return;

    setPermission(Notification.permission);

    if (!isPushFeatureEnabled()) return;

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setIsSubscribed(!!sub))
      .catch(() => setIsSubscribed(false));
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setLastError('Este navegador no soporta notificaciones push.');
      return false;
    }

    if (!isSecureNotificationContext()) {
      setLastError(formatPushSubscribeError(new Error('insecure context')));
      return false;
    }

    if (!isVapidConfigured()) {
      setLastError(formatPushSubscribeError(new Error('vapid missing')));
      return false;
    }

    if (!userEmail) {
      setLastError('Debes iniciar sesión para activar las notificaciones push.');
      return false;
    }

    setLoading(true);
    setLastError(null);

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        setLastError('Permiso de notificaciones denegado.');
        return false;
      }

      const reg = await waitForServiceWorkerRegistration();
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim();

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ subscription }),
      });

      if (!res.ok) throw new Error(`POST /api/push/subscribe falló (${res.status})`);

      setIsSubscribed(true);
      return true;
    } catch (err) {
      const message = formatPushSubscribeError(err);
      setLastError(message);
      if (!isBenignPushError(err)) {
        console.warn('[usePushNotifications] Error en subscribe:', err);
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [isSupported, userEmail]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    setLoading(true);
    setLastError(null);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setIsSubscribed(false);
        return true;
      }

      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
      setIsSubscribed(false);
      return true;
    } catch (err) {
      const message = formatPushSubscribeError(err);
      setLastError(message);
      if (!isBenignPushError(err)) {
        console.warn('[usePushNotifications] Error en unsubscribe:', err);
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [isSupported]);

  return {
    isSupported,
    isAvailable,
    isSubscribed,
    permission,
    loading,
    lastError,
    subscribe,
    unsubscribe,
  };
}
