/**
 * Helpers de acceso, slug y alcance de empresa para el Constructor de Vistas SQL.
 * Reutilizado por los endpoints de creación/edición/ejecución (Incremento 2).
 * Ver propuesta técnica §7 (permisos) y §5.3 (alcance por empresa).
 */
import { prisma } from '../prisma';
import { getAssignedSubprocessIdsForUser } from '../process/subprocessAssignments';

export const CREATE_SUBPROCESS_NAME = 'Constructor de Vistas';
export const CUSTOM_VIEWS_PROCESS_ID = 13;
/** Tope global de filas, acota el row_limit guardado de cada vista (al guardar). */
export const MAX_VIEW_ROWS = 5000;

/**
 * Tope de SEGURIDAD para el EXPORT (no para el display). El display pagina del
 * lado servidor sin tope; el export trae TODO hasta este techo para no reventar
 * memoria. Si el resultado lo supera, se trunca y se avisa. Ver §5.4.
 */
export const EXPORT_MAX_ROWS = 50000;

/** Tamaño de página por defecto del visor de una vista publicada. */
export const DEFAULT_PAGE_SIZE = 50;

/** Tamaño de página máximo aceptado (evita pedir páginas gigantes). */
export const MAX_PAGE_SIZE = 200;

/** URL del subproceso individual de una vista publicada (galería/consulta). */
export function viewSubprocessUrl(slug: string): string {
  return `/process/custom-views/v/${slug}`;
}

/**
 * ¿El usuario puede CREAR/editar/previsualizar vistas? (permiso de creación, §7).
 * Admins siempre; o quien tenga asignado el subproceso "Constructor de Vistas".
 */
export async function canCreateViews(userId: string, role: string | null): Promise<boolean> {
  if (role === 'admin') return true;
  const sub = await prisma.subprocess.findFirst({
    where: { subprocess: CREATE_SUBPROCESS_NAME },
    select: { id_subprocess: true },
  });
  if (!sub) return false;
  const assigned = await getAssignedSubprocessIdsForUser(userId);
  return assigned.includes(sub.id_subprocess);
}

/**
 * ¿El usuario puede EJECUTAR una vista publicada? (§7).
 * Admin, o creador de vistas, o quien tenga asignado el subproceso propio de la vista.
 */
export async function canRunView(
  userId: string,
  role: string | null,
  slug: string
): Promise<boolean> {
  if (role === 'admin') return true;
  const subs = await prisma.subprocess.findMany({
    where: {
      OR: [{ subprocess: CREATE_SUBPROCESS_NAME }, { subprocess_url: viewSubprocessUrl(slug) }],
    },
    select: { id_subprocess: true },
  });
  if (subs.length === 0) return false;
  const assigned = await getAssignedSubprocessIdsForUser(userId);
  return subs.some((s) => assigned.includes(s.id_subprocess));
}

/** IDs de empresa a las que el usuario tiene acceso (para inyectar el alcance). */
export async function getUserCompanyIds(userId: string): Promise<number[]> {
  const rows = await prisma.companyUser.findMany({
    where: { id_user: userId },
    select: { id_company: true },
  });
  return [...new Set(rows.map((r) => r.id_company))];
}

/** Normaliza un nombre a slug estable (sin tildes, minúsculas, guiones). */
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);
  return base || 'vista';
}

/** Devuelve un slug único en saved_view a partir de un nombre. */
export async function uniqueSlug(name: string, excludeId?: number): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  // Evita colisión; si el dueño del slug es la propia vista (edición), se acepta.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.savedView.findUnique({
      where: { slug },
      select: { id_saved_view: true },
    });
    if (!existing || existing.id_saved_view === excludeId) return slug;
    slug = `${base}-${n++}`.slice(0, 160);
  }
}

/** Valida que company_column sea un identificador SQL simple (anti-inyección). */
export function isValidColumnRef(col: string): boolean {
  // eslint-disable-next-line security/detect-unsafe-regex -- regex lineal simple de identificador SQL (opcional .columna), entrada acotada, sin backtracking catastrófico
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(col.trim());
}
