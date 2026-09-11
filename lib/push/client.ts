export function isSecureNotificationContext(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext;
}

export function isBrowserPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isVapidConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim());
}

export function isPushFeatureEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_PUSH_ENABLED === 'false') return false;
  return isBrowserPushSupported() && isSecureNotificationContext() && isVapidConfigured();
}

export function isBenignPushError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('push service error') ||
    msg.includes('registration failed') ||
    msg.includes('service worker no disponible')
  );
}

export function formatPushSubscribeError(err: unknown): string {
  if (!(err instanceof Error)) {
    return 'No se pudo activar las notificaciones push.';
  }

  const msg = err.message.toLowerCase();

  if (!isSecureNotificationContext()) {
    return 'Las notificaciones push requieren HTTPS (o localhost).';
  }

  if (!isVapidConfigured()) {
    return 'Push no configurado en este entorno (falta VAPID).';
  }

  if (msg.includes('push service error') || msg.includes('registration failed')) {
    return 'El navegador no pudo conectar con el servicio push (red, proxy o bloqueo corporativo).';
  }

  if (msg.includes('service worker no disponible')) {
    return 'El service worker no está listo. Recarga la página e intenta de nuevo.';
  }

  return err.message || 'No se pudo activar las notificaciones push.';
}

export async function waitForServiceWorkerRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service worker no soportado');
  }

  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing?.active) return existing;

  const registration = await Promise.race([
    navigator.serviceWorker.register('/sw.js'),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Service worker no disponible (¿estás en desarrollo?)')), timeoutMs)
    ),
  ]);

  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Service worker no disponible (¿estás en desarrollo?)')), timeoutMs)
    ),
  ]);

  return registration;
}
