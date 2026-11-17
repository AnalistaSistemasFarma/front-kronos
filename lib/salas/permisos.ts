/**
 * Permisos del módulo de Salas (puro: sin base, se usa también en el cliente).
 *
 * Mismo patrón de Artículos y Compras: un subproceso por nivel, asignado por
 * empresa en subprocess_user_company (Administración → Usuarios).
 *
 *   SALAS_VER_URL       '/process/salas'           ver la ocupación (es la entrada del menú)
 *   SALAS_RESERVAR_URL  '/process/salas/reservar'  reservar y cancelar lo propio (marcador)
 *   SALAS_ADMIN_URL     '/process/salas/admin'     además, cancelar reuniones de otros (marcador)
 *
 * Los dos marcadores no son páginas: el hub los oculta (dashboardRoutes.ts) y
 * cada nivel incluye a los anteriores.
 */
export const SALAS_VER_URL = '/process/salas';
export const SALAS_RESERVAR_URL = '/process/salas/reservar';
export const SALAS_ADMIN_URL = '/process/salas/admin';

export type NivelSalas = 'ver' | 'reservar' | 'admin';

const ORDEN: Record<NivelSalas, number> = { ver: 1, reservar: 2, admin: 3 };

function normalizar(url: string | null | undefined): string {
  return (url ?? '').toLowerCase().trim().replace(/\/+$/, '');
}

/** ¿Es uno de los marcadores (reservar/admin) que el hub no debe listar? */
export function isSalasMarkerSubprocess(subprocess: { subprocess_url?: string | null }): boolean {
  const url = normalizar(subprocess.subprocess_url);
  return url === SALAS_RESERVAR_URL || url === SALAS_ADMIN_URL;
}

/** Nivel más alto que dan las URLs de subproceso del usuario, o null si no tiene ninguno. */
export function nivelDesdeUrls(urls: Array<string | null | undefined>): NivelSalas | null {
  let nivel: NivelSalas | null = null;
  for (const u of urls) {
    const url = normalizar(u);
    const n: NivelSalas | null =
      url === SALAS_ADMIN_URL ? 'admin' : url === SALAS_RESERVAR_URL ? 'reservar' : url === SALAS_VER_URL ? 'ver' : null;
    if (n && (!nivel || ORDEN[n] > ORDEN[nivel])) nivel = n;
  }
  return nivel;
}

export function puedeReservar(nivel: NivelSalas | null): boolean {
  return nivel === 'reservar' || nivel === 'admin';
}

/** Cancelar: el organizador (con permiso de reservar) o un administrador del módulo. */
export function puedeCancelar(nivel: NivelSalas | null, correoSesion: string, correoOrganizador: string): boolean {
  if (nivel === 'admin') return true;
  if (!puedeReservar(nivel)) return false;
  const a = correoSesion.trim().toLowerCase();
  const b = correoOrganizador.trim().toLowerCase();
  return a !== '' && a === b;
}
