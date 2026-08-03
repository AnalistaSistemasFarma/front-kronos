/** Entrada por defecto tras login; /home resuelve Mis procesos > Solicitante > hub. */
export const DEFAULT_POST_LOGIN_URL = '/home';

/**
 * URL de login tras cerrar sesión, conservando la página actual para volver tras autenticarse.
 */
export function buildLogoutCallbackUrl(pathname: string, search = ''): string {
  const returnTo = `${pathname}${search}` || DEFAULT_POST_LOGIN_URL;
  return `/login?callbackUrl=${encodeURIComponent(returnTo)}`;
}

/** Evita redirecciones abiertas; acepta rutas relativas o URL del mismo origen. */
export function getSafeCallbackUrl(
  raw: string | null | undefined,
  origin?: string
): string {
  if (!raw?.trim()) return DEFAULT_POST_LOGIN_URL;

  const value = raw.trim();
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (origin && parsed.origin === origin) {
      return `${parsed.pathname}${parsed.search}` || DEFAULT_POST_LOGIN_URL;
    }
  } catch {
    /* URL inválida */
  }

  return DEFAULT_POST_LOGIN_URL;
}
