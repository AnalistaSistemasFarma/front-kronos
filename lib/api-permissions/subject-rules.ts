/**
 * PERMISOS API — reglas PURAS del «sujeto» de cada cliente (2026-11-09), sin
 * base de datos, red ni `node:crypto`:
 *   - qué sujeto acepta cada tipo (NIT, id de usuario, id de sistema),
 *   - la conexión con la API SAP (SAP_API_URL / SAP_API_SYNERLINK_PRIVATE_KEY),
 *   - la forma de la respuesta de la API SAP (se valida campo a campo) y el filtro de búsqueda,
 *   - el cuerpo de crear/editar un sistema externo y los textos de búsqueda.
 * El servidor (validate.ts, portal-terceros.ts, db.ts) confirma que el sujeto existe.
 */
import {
  API_CLIENT_LIMITS,
  API_CLIENT_SUBJECT_REQUIRED,
  subjectKindOf,
  type ApiClientType,
} from './constants';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const NIT_PATTERN = /^\d{5,15}$/;
/** Ids de [user] (cuid de Prisma u otros históricos): letras, números, guion y guion bajo. */
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const SYSTEM_ID_PATTERN = /^[1-9]\d{0,8}$/;
const EMAIL_LOCAL_PATTERN = /^[A-Za-z0-9._%+-]{1,64}$/;
const EMAIL_DOMAIN_LABEL_PATTERN = /^[A-Za-z0-9-]{1,63}$/;
const EMAIL_TLD_PATTERN = /^[A-Za-z]{2,24}$/;

/**
 * Correo de la persona de México: usuario@dominio.ext, sin espacios (se guarda en minúsculas).
 * Por partes y sin una sola expresión regular anidada (evita expresiones lentas con textos raros).
 */
export function isPersonEmail(value: string): boolean {
  if (value.length > API_CLIENT_LIMITS.subjectRef) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!EMAIL_LOCAL_PATTERN.test(local)) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1];
  return labels.every((label) => EMAIL_DOMAIN_LABEL_PATTERN.test(label)) && EMAIL_TLD_PATTERN.test(tld);
}

/**
 * Valida el `subjectRef` del cuerpo según el tipo. Devuelve el valor normalizado
 * (null en los tipos sin sujeto) o el error para el usuario.
 */
export function parseSubjectRef(type: ApiClientType, value: unknown): Result<string | null> {
  const kind = subjectKindOf(type);
  const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  if (!kind) {
    return empty ? { ok: true, value: null } : { ok: false, error: 'Este tipo de cliente no usa sujeto' };
  }
  if (empty) return { ok: false, error: API_CLIENT_SUBJECT_REQUIRED[kind] };
  if (typeof value !== 'string' || value.trim().length > API_CLIENT_LIMITS.subjectRef) {
    return { ok: false, error: API_CLIENT_SUBJECT_REQUIRED[kind] };
  }
  const ref = value.trim();
  if (kind === 'tercero') {
    return NIT_PATTERN.test(ref) ? { ok: true, value: ref } : { ok: false, error: 'El NIT debe tener de 5 a 15 dígitos, sin puntos ni dígito de verificación' };
  }
  if (kind === 'usuario') {
    return USER_ID_PATTERN.test(ref) ? { ok: true, value: ref } : { ok: false, error: 'Usuario de SynerLink no válido' };
  }
  if (kind === 'persona') {
    return isPersonEmail(ref)
      ? { ok: true, value: ref.toLowerCase() }
      : { ok: false, error: 'El correo de la persona no es válido' };
  }
  return SYSTEM_ID_PATTERN.test(ref) ? { ok: true, value: ref } : { ok: false, error: 'Sistema no válido' };
}

/** Recorta el nombre visible del sujeto al tamaño de la columna. */
export function clampSubjectLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').slice(0, API_CLIENT_LIMITS.subjectLabel);
}

/* ──────────────── Proveedores y clientes: API SAP (proyecto api-sap) ──────────────── */

export type SapApiConfig =
  | { ok: true; baseUrl: string; privateKeyPem: string; issuer: string; audience: string }
  | { ok: false };

/**
 * Lee SAP_API_URL y SAP_API_SYNERLINK_PRIVATE_KEY (llave PRIVADA Ed25519 de SynerLink, PEM en
 * una línea con `\n`; la pareja pública va en SYNERLINK_JWT_PUBLIC_KEY de la API SAP).
 * Opcionales: SAP_API_SYNERLINK_ISSUER (def. «synerlink») y SAP_API_AUDIENCE (def. «gss-sap-api»).
 * HTTPS obligatorio salvo en localhost / 127.0.0.1. Sin usuario/clave, consulta ni fragmento en
 * la URL. Cualquier cosa rara = «falta configurar» (nunca se llama).
 */
export function resolveSapApiConfig(env: Record<string, string | undefined>): SapApiConfig {
  const rawUrl = env.SAP_API_URL?.trim();
  const privateKeyPem = env.SAP_API_SYNERLINK_PRIVATE_KEY?.trim().replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n');
  if (!rawUrl || !privateKeyPem || !privateKeyPem.includes('-----BEGIN PRIVATE KEY-----')) return { ok: false };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false };
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return { ok: false };
  if (url.username || url.password || url.search || url.hash) return { ok: false };
  return {
    ok: true,
    baseUrl: url.origin + url.pathname.replace(/\/+$/, ''),
    privateKeyPem,
    issuer: env.SAP_API_SYNERLINK_ISSUER?.trim() || 'synerlink',
    audience: env.SAP_API_AUDIENCE?.trim() || 'gss-sap-api',
  };
}

/** Empresas de la API SAP (lista cerrada de `internal/companies` en api-sap). */
export const SAP_API_COMPANIES: readonly PortalTerceroEmpresa[] = [
  { clave: 'FARMALOGICA', nombre: 'Farmalógica' },
  { clave: 'ONELATAM', nombre: 'One Latam Pharma' },
  { clave: 'GSS', nombre: 'Group Shared Services' },
  { clave: 'ABAMIA', nombre: 'Abamia' },
  { clave: 'MEDITRACK', nombre: 'Meditrack' },
  { clave: 'KELAB', nombre: 'Kelab Analítica' },
  { clave: 'BIOSELECT', nombre: 'Bioselect' },
  { clave: 'RYAN', nombre: 'Ryan' },
];

export interface PortalTerceroEmpresa {
  clave: string;
  nombre: string;
}

/** Proveedor o cliente de SAP, agrupado por NIT entre las empresas donde existe. */
export interface PortalTercero {
  nit: string;
  nombre: string | null;
  empresas: PortalTerceroEmpresa[];
  /** «Proveedor», «Cliente», «Proveedor y cliente» o null si SAP no lo dice. */
  tipo: string | null;
}

/** Filtro de `GET /v1/suppliers`: exactamente uno (contrato de la API SAP). */
export type SapSupplierQuery = { nit: string } | { nombre: string };

const SAP_NAME_PATTERN = /^[\p{L}\p{N} .&,-]+$/u;

/**
 * Convierte lo que escribe el usuario en el filtro de la API SAP: solo dígitos (se aceptan
 * puntos, espacios y guion: «900.123.456») → NIT que «empieza por» (5 a 15 dígitos); si no,
 * nombre que «contiene» (3 a 60, letras, números y ` .&,-`). null = no se puede buscar.
 */
export function sapSupplierQuery(q: string): SapSupplierQuery | null {
  const text = q.trim().replace(/\s+/g, ' ');
  const digits = text.replace(/[.\s-]/g, '');
  if (/^\d+$/.test(digits)) return NIT_PATTERN.test(digits) ? { nit: digits } : null;
  return text.length >= 3 && text.length <= 60 && SAP_NAME_PATTERN.test(text) ? { nombre: text } : null;
}

/** NIT de SAP (FederalTaxID, p. ej. «900.123.456-7») → solo dígitos SIN dígito de verificación. */
export function normalizeSapNit(federalTaxId: unknown): string | null {
  if (typeof federalTaxId !== 'string') return null;
  const digits = federalTaxId.split('-')[0].replace(/\D/g, '');
  return NIT_PATTERN.test(digits) ? digits : null;
}

const MAX_SAP_ITEMS = 50;

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function tipoLabel(types: Set<string>): string | null {
  const supplier = types.has('PROVEEDOR');
  const customer = types.has('CLIENTE');
  if (supplier && customer) return 'Proveedor y cliente';
  if (supplier) return 'Proveedor';
  if (customer) return 'Cliente';
  return null;
}

/**
 * Une las respuestas `{ items: Partner[] }` de cada empresa en una lista por NIT. No confía en
 * el otro sistema: descarta respuestas y socios mal formados. Orden por nombre, máximo 50.
 */
export function mergeSapPartners(responses: { empresa: PortalTerceroEmpresa; body: unknown }[]): PortalTercero[] {
  const byNit = new Map<string, { nombre: string | null; empresas: Map<string, PortalTerceroEmpresa>; types: Set<string> }>();
  for (const { empresa, body } of responses) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) continue;
    const items = (body as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const nit = normalizeSapNit(item.nit);
      if (!nit) continue;
      const entry = byNit.get(nit) ?? { nombre: null, empresas: new Map(), types: new Set<string>() };
      entry.nombre ??= shortText(item.cardName, API_CLIENT_LIMITS.subjectLabel);
      entry.empresas.set(empresa.clave, empresa);
      if (typeof item.type === 'string') entry.types.add(item.type);
      byNit.set(nit, entry);
    }
  }
  return [...byNit.entries()]
    .map(([nit, e]) => ({ nit, nombre: e.nombre, empresas: [...e.empresas.values()], tipo: tipoLabel(e.types) }))
    .sort((a, b) => (a.nombre ?? a.nit).localeCompare(b.nombre ?? b.nit, 'es'))
    .slice(0, MAX_SAP_ITEMS);
}

/**
 * Texto de búsqueda (`?q=`): vacío = sin filtro; si viene, 2 a 60 caracteres
 * (el selector manda lo que escribe el usuario). null = no válido.
 */
export function parseSearchQuery(value: string | null | undefined): string | null | '' {
  const q = (value ?? '').trim().replace(/\s+/g, ' ');
  if (q === '') return '';
  return q.length >= 2 && q.length <= 60 ? q : null;
}

/* ──────────── Qué ve cada proveedor en el portal (API de la landing gss-landingpage) ──────────── */

export type PortalAccessConfig = { ok: true; baseUrl: string; key: string } | { ok: false };

/**
 * Lee PORTAL_TERCEROS_URL (raíz de la landing) y PORTAL_TERCEROS_KEY (la misma llave que la landing
 * guarda como INTEGRACION_SYNERLINK_KEY, mínimo 32 caracteres). Mismas reglas de URL que la API SAP.
 */
export function resolvePortalAccessConfig(env: Record<string, string | undefined>): PortalAccessConfig {
  const rawUrl = env.PORTAL_TERCEROS_URL?.trim();
  const key = env.PORTAL_TERCEROS_KEY?.trim().replace(/^['"]|['"]$/g, '');
  if (!rawUrl || !key || key.length < 32) return { ok: false };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false };
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return { ok: false };
  if (url.username || url.password || url.search || url.hash) return { ok: false };
  return { ok: true, baseUrl: url.origin + url.pathname.replace(/\/+$/, ''), key };
}

export interface PortalModulo {
  clave: string;
  nombre: string;
  area: string;
}

export interface PortalAccesoUsuario {
  nombre: string;
  rol: string | null;
  modulos: PortalModulo[];
}

export interface PortalAccesoEmpresa {
  clave: string;
  nombre: string;
  cardCode: string | null;
  usuarios: PortalAccesoUsuario[];
}

/** Lo que ve un NIT en el portal. `modulos` = módulos distintos entre todas sus empresas y usuarios. */
export interface PortalAcceso {
  nit: string;
  empresas: PortalAccesoEmpresa[];
  modulos: number;
  usuarios: number;
}

export const MAX_PORTAL_ACCESS_NITS = 50;

/** `?nits=a,b,c` → NIT únicos válidos (1 a 50). null = no válido. */
export function parseNitList(value: string | null | undefined): string[] | null {
  const nits = [...new Set((value ?? '').split(',').map((n) => n.trim()).filter(Boolean))];
  if (nits.length === 0 || nits.length > MAX_PORTAL_ACCESS_NITS || nits.some((n) => !NIT_PATTERN.test(n))) return null;
  return nits;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * Respuesta de GET {landing}/api/integraciones/terceros/accesos → un PortalAcceso por cada NIT
 * pedido (los que no tienen vínculos activos quedan con 0). No confía en el otro sistema: descarta
 * lo mal formado y recorta textos.
 */
export function parsePortalAccess(body: unknown, nits: string[]): Record<string, PortalAcceso> {
  const result: Record<string, PortalAcceso> = {};
  for (const nit of nits) result[nit] = { nit, empresas: [], modulos: 0, usuarios: 0 };
  for (const rawItem of asArray(asRecord(body)?.items)) {
    const item = asRecord(rawItem);
    const nit = typeof item?.nit === 'string' ? item.nit : '';
    if (!item || !result[nit]) continue;
    const empresas: PortalAccesoEmpresa[] = [];
    const modulos = new Set<string>();
    // Personas distintas por `ref` (la misma persona puede estar en varias empresas); sin ref, cuenta cada fila.
    const personas = new Set<string>();
    for (const rawEmpresa of asArray(item.empresas)) {
      const empresa = asRecord(rawEmpresa);
      const clave = shortText(empresa?.clave, 50);
      if (!empresa || !clave) continue;
      const users: PortalAccesoUsuario[] = [];
      for (const rawUser of asArray(empresa.usuarios)) {
        const user = asRecord(rawUser);
        if (!user) continue;
        const mods: PortalModulo[] = [];
        for (const rawMod of asArray(user.modulos)) {
          const mod = asRecord(rawMod);
          const modClave = shortText(mod?.clave, 60);
          if (!mod || !modClave) continue;
          mods.push({ clave: modClave, nombre: shortText(mod.nombre, 120) ?? modClave, area: shortText(mod.area, 80) ?? 'Otros' });
          modulos.add(modClave);
        }
        users.push({ nombre: shortText(user.nombre, 200) ?? 'Usuario sin nombre', rol: shortText(user.rol, 80), modulos: mods });
        personas.add(Number.isInteger(user.ref) ? `r${user.ref}` : `${clave}#${users.length}`);
      }
      empresas.push({ clave, nombre: shortText(empresa.nombre, 120) ?? clave, cardCode: shortText(empresa.cardCode, 50), usuarios: users });
    }
    result[nit] = { nit, empresas, modulos: modulos.size, usuarios: personas.size };
  }
  return result;
}

/* ─────────────────────────────── Sistemas externos ─────────────────────────────── */

export interface ExternalSystemInput {
  name: string;
  description: string | null;
  active: boolean;
}

const SYSTEM_KEYS = new Set(['name', 'description', 'active']);

function systemName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= API_CLIENT_LIMITS.systemName ? name : null;
}

const SYSTEM_NAME_ERROR = `El nombre del sistema debe tener entre 2 y ${API_CLIENT_LIMITS.systemName} caracteres`;
const SYSTEM_DESCRIPTION_ERROR = `La descripción admite hasta ${API_CLIENT_LIMITS.systemDescription} caracteres`;

function systemDescription(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length > API_CLIENT_LIMITS.systemDescription) return undefined;
  return text || null;
}

/** Crear: nombre obligatorio; descripción y activo opcionales (activo por defecto). Estricto. */
export function parseExternalSystemCreate(body: unknown): Result<ExternalSystemInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Datos no válidos' };
  const raw = body as Record<string, unknown>;
  if (Object.keys(raw).some((k) => !SYSTEM_KEYS.has(k))) return { ok: false, error: 'Datos no válidos' };
  const name = systemName(raw.name);
  if (!name) return { ok: false, error: SYSTEM_NAME_ERROR };
  const description = systemDescription(raw.description);
  if (description === undefined) return { ok: false, error: SYSTEM_DESCRIPTION_ERROR };
  if (raw.active !== undefined && typeof raw.active !== 'boolean') return { ok: false, error: 'Indica si el sistema está activo' };
  return { ok: true, value: { name, description, active: raw.active ?? true } };
}

/** Editar: cualquier subconjunto de nombre, descripción y activo (al menos uno). Estricto. */
export function parseExternalSystemPatch(body: unknown): Result<Partial<ExternalSystemInput>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Datos no válidos' };
  const raw = body as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length === 0 || keys.some((k) => !SYSTEM_KEYS.has(k))) return { ok: false, error: 'Datos no válidos' };
  const value: Partial<ExternalSystemInput> = {};
  if ('name' in raw) {
    const name = systemName(raw.name);
    if (!name) return { ok: false, error: SYSTEM_NAME_ERROR };
    value.name = name;
  }
  if ('description' in raw) {
    const description = systemDescription(raw.description);
    if (description === undefined) return { ok: false, error: SYSTEM_DESCRIPTION_ERROR };
    value.description = description;
  }
  if ('active' in raw) {
    if (typeof raw.active !== 'boolean') return { ok: false, error: 'Indica si el sistema está activo' };
    value.active = raw.active;
  }
  return { ok: true, value };
}
