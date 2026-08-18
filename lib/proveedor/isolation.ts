// Utilidades PURAS del aislamiento de datos de proveedores. SIN dependencias de BD
// ni de next-auth para poder testearlas de forma unitaria (vitest). Aquí vive la
// lógica de seguridad crítica: derivar la identidad del proveedor EXCLUSIVAMENTE de
// la sesión del servidor y validar la propiedad de cada recurso por su NIT/usuario.
//
// REGLA DE ORO: el NIT o el id de usuario del proveedor NUNCA se toman del cliente
// (query string, body, params). Solo de la sesión autenticada del lado del servidor.

/** Rol del tipo de usuario Proveedor. Único punto de verdad del string del rol. */
export const SUPPLIER_ROLE = 'supplier';

/** Identidad del proveedor derivada de la sesión del servidor. */
export interface SupplierIdentity {
  /** id (cuid) del usuario proveedor en la tabla [user]. */
  userId: string;
  /** NIT normalizado del proveedor. */
  nit: string;
}

/**
 * Normaliza un NIT: lo convierte a string, recorta espacios y descarta separadores
 * comunes (puntos, espacios, guiones) para comparar de forma estable. NO valida el
 * dígito de verificación; solo canoniza para comparación y scoping.
 */
export function normalizeNit(nit: unknown): string {
  if (nit == null) return '';
  return String(nit)
    .trim()
    .replace(/[.\s-]/g, '');
}

/** Forma mínima de la sesión que necesitamos inspeccionar (evita acoplar a next-auth). */
export interface SessionLike {
  user?: {
    id?: string | null;
    role?: string | null;
    nit?: string | null;
  } | null;
}

/**
 * Deriva la identidad del proveedor a partir de la sesión del servidor.
 * Devuelve null si:
 *  - no hay sesión / usuario,
 *  - el rol no es exactamente 'supplier',
 *  - falta el id de usuario o el NIT.
 *
 * DENY BY DEFAULT: cualquier caso dudoso devuelve null (sin acceso).
 */
export function extractSupplierIdentity(session: SessionLike | null | undefined): SupplierIdentity | null {
  const user = session?.user;
  if (!user) return null;
  if (user.role !== SUPPLIER_ROLE) return null;

  const userId = typeof user.id === 'string' ? user.id.trim() : '';
  const nit = normalizeNit(user.nit);
  if (!userId || !nit) return null;

  return { userId, nit };
}

/**
 * Valida que un recurso pertenezca al proveedor de la sesión comparando el
 * id_requester del recurso contra el id de usuario del proveedor.
 * Ambos deben ser no vacíos e idénticos. Previene IDOR: aunque el cliente pida un
 * id que no es suyo, el recurso solo se entrega si su dueño coincide con la sesión.
 */
export function assertOwnership(
  resourceRequesterId: unknown,
  supplierUserId: unknown
): boolean {
  const a = resourceRequesterId == null ? '' : String(resourceRequesterId).trim();
  const b = supplierUserId == null ? '' : String(supplierUserId).trim();
  return a.length > 0 && b.length > 0 && a === b;
}

/**
 * ¿La ruta pertenece al área EXCLUSIVA de proveedores?
 * (páginas /proveedor/portal y API /api/proveedor). El login /proveedor/login es
 * público y NO cuenta como área protegida.
 */
export function isSupplierProtectedPath(pathname: string): boolean {
  return (
    pathname.startsWith('/proveedor/portal') ||
    pathname.startsWith('/api/proveedor')
  );
}

/**
 * ¿Es una ruta de API INTERNA que un proveedor JAMÁS debe tocar?
 * Todo /api/* excepto: el área de proveedores (/api/proveedor), la propia
 * autenticación (/api/auth), lo público sin login (/api/public) y health checks.
 */
export function isInternalApiPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/api/proveedor')) return false;
  if (pathname.startsWith('/api/auth')) return false;
  if (pathname.startsWith('/api/public')) return false;
  if (pathname.startsWith('/api/health')) return false;
  return true;
}
