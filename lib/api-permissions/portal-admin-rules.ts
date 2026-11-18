/**
 * PERMISOS API — reglas PURAS de la administración del portal de proveedores desde SynerLink
 * (2026-11-09). SynerLink es la consola: crea y desactiva los usuarios del proveedor, los vincula
 * a empresas y marca sus módulos; la landing (gss-landingpage, lib/portal/synerlink-admin.ts)
 * guarda y vuelve a validar todo (cupo de 3 por NIT, documento único, socio confirmado en SAP).
 *
 * Aquí solo se filtra el cuerpo: lista cerrada de acciones y de campos, tipos y tamaños. Lo que
 * no está en la lista no se reenvía.
 */
import { NIT_PATTERN } from './subject-rules';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const PORTAL_ADMIN_ACTIONS = [
  'buscar-socios',
  'crear-usuario',
  'editar-usuario',
  'restablecer-password',
  'vincular',
  'editar-vinculo',
  'desvincular',
] as const;
export type PortalAdminAction = (typeof PORTAL_ADMIN_ACTIONS)[number];

/** Campos permitidos por acción (además de `action` y `nit`). */
const FIELDS: Record<PortalAdminAction, readonly string[]> = {
  'buscar-socios': ['company'],
  'crear-usuario': ['nombre', 'email', 'tipoDocumento', 'numeroDocumento', 'portalRole', 'company', 'cardCode'],
  'editar-usuario': ['userId', 'nombre', 'email', 'portalRole', 'active'],
  'restablecer-password': ['userId'],
  vincular: ['userId', 'company', 'cardCode'],
  'editar-vinculo': ['userId', 'linkId', 'resources', 'active'],
  desvincular: ['userId', 'linkId'],
};

const REQUIRED: Record<PortalAdminAction, readonly string[]> = {
  'buscar-socios': ['company'],
  'crear-usuario': ['nombre', 'numeroDocumento', 'portalRole', 'company', 'cardCode'],
  'editar-usuario': ['userId'],
  'restablecer-password': ['userId'],
  vincular: ['userId', 'company', 'cardCode'],
  'editar-vinculo': ['userId', 'linkId'],
  desvincular: ['userId', 'linkId'],
};

const MAX_TEXT: Record<string, number> = {
  nombre: 200,
  email: 320,
  tipoDocumento: 20,
  numeroDocumento: 30,
  portalRole: 20,
  company: 50,
  cardCode: 50,
  userId: 50,
  linkId: 50,
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;
const RESOURCE_PATTERN = /^[a-z0-9-]{1,60}$/;

export function isPortalAdminAction(value: unknown): value is PortalAdminAction {
  return typeof value === 'string' && (PORTAL_ADMIN_ACTIONS as readonly string[]).includes(value);
}

/** Valida el cuerpo de POST …/portal-terceros/admin. Devuelve lo que se reenvía a la landing. */
export function parsePortalAdminBody(body: unknown): Result<Record<string, unknown> & { action: PortalAdminAction; nit: string }> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Datos no válidos' };
  const raw = body as Record<string, unknown>;
  if (!isPortalAdminAction(raw.action)) return { ok: false, error: 'Acción no válida' };
  const action = raw.action;
  const nit = typeof raw.nit === 'string' ? raw.nit.trim() : '';
  if (!NIT_PATTERN.test(nit)) return { ok: false, error: 'NIT no válido' };

  const allowed = new Set(['action', 'nit', ...FIELDS[action]]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return { ok: false, error: 'Datos no válidos' };

  const value: Record<string, unknown> = { action, nit };
  for (const key of FIELDS[action]) {
    if (!(key in raw)) continue;
    const field = raw[key];
    if (key === 'active') {
      if (typeof field !== 'boolean') return { ok: false, error: 'Estado no válido' };
      value.active = field;
    } else if (key === 'resources') {
      if (!Array.isArray(field) || field.length > 50 || !field.every((r) => typeof r === 'string' && RESOURCE_PATTERN.test(r))) {
        return { ok: false, error: 'Módulos no válidos' };
      }
      value.resources = [...new Set(field as string[])];
    } else {
      if (typeof field !== 'string') return { ok: false, error: 'Datos no válidos' };
      const text = field.trim();
      if (text.length > (MAX_TEXT[key] ?? 120)) return { ok: false, error: 'Un campo es demasiado largo' };
      if ((key === 'userId' || key === 'linkId') && !ID_PATTERN.test(text)) return { ok: false, error: 'Datos no válidos' };
      value[key] = text;
    }
  }
  for (const key of REQUIRED[action]) {
    if (value[key] === undefined || value[key] === '') return { ok: false, error: REQUIRED_MESSAGES[key] ?? 'Faltan datos' };
  }
  if (action === 'editar-usuario' && Object.keys(value).length <= 3) return { ok: false, error: 'No hay cambios' };
  if (action === 'editar-vinculo' && value.resources === undefined && value.active === undefined) {
    return { ok: false, error: 'No hay cambios' };
  }
  return { ok: true, value: value as Record<string, unknown> & { action: PortalAdminAction; nit: string } };
}

const REQUIRED_MESSAGES: Record<string, string> = {
  nombre: 'Escribe el nombre del usuario',
  numeroDocumento: 'Escribe el número de documento (es su usuario de ingreso)',
  portalRole: 'Elige el rol del usuario en el portal',
  company: 'Elige la empresa',
  cardCode: 'Elige el socio de SAP',
};
