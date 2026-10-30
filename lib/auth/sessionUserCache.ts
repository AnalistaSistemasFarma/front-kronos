import 'server-only';

/** Fila de [user] que la sesión copia en el token (rol, tema, foto…). */
export type SessionUserRow = {
  id: string;
  role: string;
  image: string | null;
  themePalette: string | null;
  colorScheme: string | null;
  uiFont: string | null;
  nit: string | null;
};

/**
 * Lectura reciente de [user] por correo, compartida por el callback jwt (que corre en cada
 * getServerSession) y por quien cambia el perfil. Vive en globalThis para sobrevivir a la
 * recarga de módulos en desarrollo.
 */
export const sessionUserCache: Map<string, { row: SessionUserRow | undefined; at: number }> =
  ((globalThis as Record<string, unknown>).__kronosSessionUserCache as never) ??
  ((globalThis as Record<string, unknown>).__kronosSessionUserCache = new Map());

/**
 * Olvida la lectura guardada de un usuario: la próxima sesión del servidor lee la BD. Se usa
 * al guardar el perfil para no tener que pedir update() desde el navegador (update() pone la
 * sesión en "cargando" y el encabezado y el menú parpadean).
 */
export function forgetSessionUser(email: string | null | undefined): void {
  const key = String(email || '').trim().toLowerCase();
  if (key) sessionUserCache.delete(key);
}
