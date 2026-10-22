/**
 * Piezas PURAS del flujo de NextAuth que usa la auditoría de inicios de sesión
 * (sin BD, sin `server-only`): qué petición es un intento de inicio de sesión y
 * cómo se lee el resultado en la respuesta. Se prueban en flow.test.ts.
 */
import { LOGIN_AUDIT_LIMITS, isLoginProvider, type LoginProvider } from './constants';

/**
 * Si la petición es el «callback» de NextAuth de un proveedor que se audita,
 * devuelve el proveedor. Es el único paso donde se decide el inicio de sesión:
 *   - credentials / supplier-nit → POST /api/auth/callback/<id> (ahí corre authorize)
 *   - azure-ad                   → GET  /api/auth/callback/azure-ad (regreso de Microsoft)
 * Las demás rutas (session, csrf, providers, signin, signout) no son intentos.
 */
export function callbackProviderFromUrl(url: string): LoginProvider | null {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }
  const parts = pathname.split('/').filter(Boolean);
  const at = parts.indexOf('auth');
  if (at < 0 || parts[at - 1] !== 'api' || parts[at + 1] !== 'callback') return null;
  const provider = parts[at + 2];
  if (parts.length !== at + 3) return null;
  return isLoginProvider(provider) ? provider : null;
}

/**
 * Código de error que NextAuth deja en la URL de destino (`?error=CredentialsSignin`,
 * `?error=OAuthCallback`, `?error=AccessDenied`…). null si no hay error.
 */
export function errorFromRedirectUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const value = new URL(url, 'http://localhost').searchParams.get('error');
    return value ? value.slice(0, 60) : null;
  } catch {
    return null;
  }
}

/**
 * ¿NextAuth rechazó la petición por CSRF? Lo indica redirigiendo a
 * `/api/auth/signin?csrf=true` (sin `error=`), y en ese caso `authorize` no corre.
 */
export function csrfRejectedFromRedirectUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url, 'http://localhost').searchParams.get('csrf') === 'true';
  } catch {
    return false;
  }
}

/** Correo o NIT tal como se intentó: sin espacios, en minúsculas, recortado. */
export function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return clean ? clean.slice(0, LOGIN_AUDIT_LIMITS.identifier) : null;
}
