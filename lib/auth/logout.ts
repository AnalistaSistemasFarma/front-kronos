/**
 * URL de login tras cerrar sesión, conservando la página actual para volver tras autenticarse.
 */
export function buildLogoutCallbackUrl(pathname: string, search = ''): string {
  const returnTo = `${pathname}${search}` || '/process';
  return `/login?callbackUrl=${encodeURIComponent(returnTo)}`;
}

/** Evita redirecciones abiertas; acepta rutas relativas o URL del mismo origen. */
export function getSafeCallbackUrl(
  raw: string | null | undefined,
  origin?: string
): string {
  if (!raw?.trim()) return '/process';

  const value = raw.trim();
  if (value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (origin && parsed.origin === origin) {
      return `${parsed.pathname}${parsed.search}` || '/process';
    }
  } catch {
    /* URL inválida */
  }

  return '/process';
}
