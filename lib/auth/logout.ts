/** Entrada por defecto tras login; /home resuelve Mis procesos > Solicitante > hub. */
export const DEFAULT_POST_LOGIN_URL = '/home';

/**
 * Limpia datos de sesión en el navegador (mismo PC / otro usuario).
 * No toca cookies HttpOnly de NextAuth (las limpia `signOut`).
 */
export function clearClientSessionArtifacts() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('selectedCompany');
    // Rastros típicos de NextAuth / MSAL en storage (si existieran).
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith('nextauth') ||
        key.startsWith('oidc.') ||
        key.startsWith('msal.') ||
        key.includes('azure') ||
        key.startsWith('request-') ||
        key.startsWith('ticket-')
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
}

/**
 * URL de login tras cerrar sesión.
 * Por defecto no retiene callbackUrl de la página actual: en PCs compartidos
 * eso podía reabrir la sesión/contexto del usuario anterior.
 */
export function buildLogoutCallbackUrl(_pathname?: string, _search = ''): string {
  void _pathname;
  void _search;
  const origin =
    typeof window !== 'undefined' ? window.location.origin : process.env.NEXTAUTH_URL || '';
  const postLogout = `${origin.replace(/\/$/, '')}/login`;

  const tenant = String(
    process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID ||
      process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID ||
      process.env.AZURE_AD_TENANT_ID ||
      ''
  ).trim();
  // Cierra también la sesión SSO de Microsoft para que el siguiente usuario
  // no herede cookies de Azure AD en el mismo navegador.
  if (tenant && tenant !== 'your-tenant-id') {
    const logout = new URL(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/logout`
    );
    logout.searchParams.set('post_logout_redirect_uri', postLogout);
    return logout.toString();
  }

  return '/login';
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
