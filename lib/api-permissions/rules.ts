/**
 * PERMISOS API — reglas PURAS (sin base de datos ni `server-only`).
 *
 * Pedido de Juan Fonseca (2026-11-09): SynerLink es la fuente única de permisos
 * de los «clientes de API» (agentes de IA, Portal de terceros y México). Cada
 * cliente tiene empresas, permisos (fase 1: las herramientas kronos_* del MCP)
 * y una o varias llaves. La llave en claro se muestra UNA vez y nunca se guarda:
 * en la base solo queda su SHA-256 (hex) y un prefijo visible para reconocerla.
 *
 * Lo usan la API de administración, `authenticate.ts`, la pantalla y las pruebas.
 * El MCP (mcp/src/dbKeys.ts) replica el hash y la comparación porque es un
 * paquete aparte.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  AGENT_CODE_REQUIRED_MESSAGE,
  API_CLIENT_LIMITS,
  DEFAULT_API_ACCESS_MODE,
  PERMISSION_COMPANY_OUTSIDE_MESSAGE,
  clientTypeUsesApiAccess,
  isApiAccessMode,
  isApiClientType,
  permissionRequiresAgentCode,
  type ApiAccessMode,
  type ApiClientType,
} from './constants';
import { parseSubjectRef } from './subject-rules';

export {
  AGENT_CODE_REQUIRED_MESSAGE,
  API_CLIENT_LIMITS,
  API_CLIENT_TYPES,
  API_CLIENT_TYPE_LABELS,
  PERMISSIONS_REQUIRING_AGENT_CODE,
  isApiClientType,
  permissionRequiresAgentCode,
  type ApiClientType,
} from './constants';

/* ─────────────────────────────── Catálogo (fase 1) ─────────────────────────────── */

/**
 * Las 53 herramientas del MCP de Kronos (mcp/src/tools/*.ts). La fuente de verdad
 * es la tabla `api_permission` (semilla en prisma/manual/2026-11-09-permisos-api-*.sql);
 * esta lista sirve para las pruebas de coherencia y como documentación.
 */
export const SYNERLINK_TOOL_PERMISSIONS = [
  'kronos_list_requests',
  'kronos_get_request',
  'kronos_list_request_notes',
  'kronos_list_request_tasks',
  'kronos_get_request_fields',
  'kronos_list_attachments',
  'kronos_get_attachment',
  'kronos_create_request',
  'kronos_get_process_fields',
  'kronos_add_note',
  'kronos_resolve_task',
  'kronos_set_request_fields',
  'kronos_categorize_request',
  'kronos_upload_attachment',
  'kronos_delete_attachment',
  'kronos_list_processes',
  'kronos_list_process_categories',
  'kronos_list_departments',
  'kronos_list_categories',
  'kronos_list_users',
  'kronos_list_tickets',
  'kronos_get_ticket',
  'kronos_categorize_case',
  'kronos_list_activities',
  'kronos_metadata',
  'kronos_search',
  'kronos_request_ia_access',
  // Bitácora de Proceso (mcp/src/tools/bitacoraProceso.ts)
  'kronos_list_bitacoras',
  'kronos_get_bitacora',
  'kronos_bitacora_actividad_reciente',
  'kronos_list_bitacora_actividades',
  // Proyectos (mcp/src/tools/proyectos.ts)
  'proyectos_listar',
  'proyecto_detalle',
  'proyecto_cronograma',
  'proyecto_calendario',
  'proyecto_historial',
  'proyecto_prs',
  'proyecto_proponer_tarea',
  'proyecto_proponer_cambio_tarea',
  'proyecto_proponer_vincular_solicitud',
  'proyecto_proponer_desvincular_solicitud',
  'proyecto_proponer_conversacion',
  'proyecto_proponer_invitar',
  // Correo «Consultar a un agente» (mcp/src/tools/correoAgente.ts)
  'correo_hilo_compartido',
  'correo_adjunto_compartido',
  'correo_proponer_respuesta',
  'correo_crear_solicitud_desde_hilo',
  'correo_agregar_nota',
  // Teams (mcp/src/tools/index.ts)
  'teams_list_meetings',
  'teams_list_transcripts',
  'teams_get_transcript',
  // Usuarios (mcp/src/tools/usuarios.ts): en la semilla con active = 0.
  'kronos_usuarios_consultar',
  'kronos_usuarios_crear',
] as const;

/**
 * Permisos que se siembran INACTIVOS (se ven, no se pueden otorgar): exigen el
 * bloque `usuarios` de la llave del archivo (mcp/src/config.ts, USUARIOS_TOOL_NAMES
 * y usuariosConfigSchema), que `api_client` todavía no puede representar.
 */
export const NOT_GRANTABLE_PERMISSIONS = ['kronos_usuarios_consultar', 'kronos_usuarios_crear'] as const;

/* ─────────────────────────────── Llaves ─────────────────────────────── */

export const API_KEY_PREFIX = 'sk_syn_';
/** Caracteres visibles que se guardan para reconocer la llave (prefijo + 6 del secreto). */
export const API_KEY_VISIBLE_CHARS = API_KEY_PREFIX.length + 6;
/** 32 bytes en base64url = 43 caracteres. */
const API_KEY_RANDOM_BYTES = 32;
const API_KEY_PATTERN = /^sk_syn_[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiKey {
  /** Llave en claro: se muestra UNA vez y no se guarda. */
  key: string;
  /** SHA-256 hex (64 caracteres), lo único que se guarda. */
  hash: string;
  /** Primeros caracteres visibles, p. ej. «sk_syn_Ab12Cd». */
  prefix: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function apiKeyVisiblePrefix(key: string): string {
  return key.slice(0, API_KEY_VISIBLE_CHARS);
}

export function generateApiKey(random: (size: number) => Buffer = randomBytes): GeneratedApiKey {
  const key = `${API_KEY_PREFIX}${random(API_KEY_RANDOM_BYTES).toString('base64url')}`;
  return { key, hash: hashApiKey(key), prefix: apiKeyVisiblePrefix(key) };
}

/** ¿Tiene la forma de una llave de SynerLink? (descarta basura antes de ir a la base). */
export function looksLikeApiKey(token: string | null | undefined): token is string {
  return typeof token === 'string' && API_KEY_PATTERN.test(token);
}

/** Compara dos hash SHA-256 hex en tiempo constante. Falso si alguno no es un hash válido. */
export function safeEqualHash(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase(), 'hex'), Buffer.from(b.toLowerCase(), 'hex'));
}

/**
 * Busca el hash de `token` entre `candidates` recorriéndolos TODOS (sin
 * cortocircuito), para no filtrar por tiempo cuál existe.
 */
export function findByKeyHash<T extends { keyHash: string }>(token: string | null, candidates: readonly T[]): T | null {
  if (!token) return null;
  const hash = hashApiKey(token);
  let matched: T | null = null;
  for (const candidate of candidates) {
    if (safeEqualHash(hash, candidate.keyHash)) matched = candidate;
  }
  return matched;
}

/** Extrae el token de `Authorization: Bearer <token>`. */
export function extractBearerToken(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) return null;
  return match[1].trim();
}

/** Intervalo mínimo entre dos actualizaciones de `last_used_at` de una misma llave. */
export const LAST_USED_THROTTLE_MS = 60_000;

/** ¿Toca escribir `last_used_at`? Como máximo una vez por minuto por llave. */
export function shouldTouchLastUsed(lastTouchedMs: number | undefined, nowMs: number): boolean {
  return lastTouchedMs === undefined || nowMs - lastTouchedMs >= LAST_USED_THROTTLE_MS;
}

/* ─────────────────────────────── Validación del cuerpo ─────────────────────────────── */

export interface ApiClientInput {
  name: string;
  clientType: ApiClientType;
  description: string | null;
  agentCode: string | null;
  allCompanies: boolean;
  /** Vacío cuando `allCompanies` es verdadero. */
  companyIds: number[];
  permissionCodes: string[];
  active: boolean;
  /**
   * Sujeto según el tipo (NIT del tercero, id del usuario SynerLink o id del sistema);
   * null en agente y México. Lo valida `parseSubjectRef` y lo confirma el servidor.
   */
  subjectRef: string | null;
  /** Nombre visible del sujeto: lo pone SIEMPRE el servidor (validate.ts), nunca el navegador. */
  subjectLabel: string | null;
  /** Nivel de acceso (2026-11-11): 'lectura' (por defecto) o 'escritura'. Aplica a todos los tipos. */
  accessMode: ApiAccessMode;
  /**
   * Permisos por empresa (2026-11-11): código → empresas donde vale. Un permiso que NO está aquí vale en
   * todas las empresas del cliente. Tabla api_client_permission_company.
   */
  permissionCompanies: Record<string, number[]>;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const INPUT_KEYS = new Set([
  'name',
  'clientType',
  'description',
  'agentCode',
  'allCompanies',
  'companyIds',
  'permissionCodes',
  'active',
  'subjectRef',
  'accessMode',
  'permissionCompanies',
]);

const AGENT_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,59}$/;

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) return undefined;
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Valida el cuerpo de crear/editar un cliente (objeto completo en ambos casos).
 * Estricto: rechaza campos desconocidos y tipos incorrectos. `knownPermissions`
 * = códigos ACTIVOS del catálogo.
 */
export function parseApiClientInput(body: unknown, knownPermissions: ReadonlySet<string>): ParseResult<ApiClientInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Datos no válidos' };
  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!INPUT_KEYS.has(key)) return { ok: false, error: 'Datos no válidos' };
  }

  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 3 || name.length > API_CLIENT_LIMITS.name) {
    return { ok: false, error: `El nombre debe tener entre 3 y ${API_CLIENT_LIMITS.name} caracteres` };
  }

  if (!isApiClientType(raw.clientType)) return { ok: false, error: 'Tipo de cliente no válido' };

  const description = optionalText(raw.description, API_CLIENT_LIMITS.description);
  if (description === undefined) {
    return { ok: false, error: `La descripción admite hasta ${API_CLIENT_LIMITS.description} caracteres` };
  }

  const agentCodeRaw = optionalText(raw.agentCode, API_CLIENT_LIMITS.agentCode);
  const agentCode = typeof agentCodeRaw === 'string' ? agentCodeRaw.toLowerCase() : agentCodeRaw;
  if (agentCode === undefined || (agentCode !== null && !AGENT_CODE_PATTERN.test(agentCode))) {
    return { ok: false, error: 'El código de agente solo admite minúsculas, números, guion y guion bajo' };
  }

  if (typeof raw.allCompanies !== 'boolean') return { ok: false, error: 'Indique si aplica a todas las empresas' };
  const allCompanies = raw.allCompanies;

  if (!Array.isArray(raw.companyIds) || raw.companyIds.length > API_CLIENT_LIMITS.maxCompanies) {
    return { ok: false, error: 'Empresas no válidas' };
  }
  const companyIds: number[] = [];
  for (const id of raw.companyIds) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return { ok: false, error: 'Empresas no válidas' };
    if (!companyIds.includes(id)) companyIds.push(id);
  }
  // «Proveedor o cliente» no se conecta por API: no se le exigen empresas (solo se administra su portal).
  if (!allCompanies && companyIds.length === 0 && clientTypeUsesApiAccess(raw.clientType)) {
    return { ok: false, error: 'Elija al menos una empresa o marque «Todas las empresas»' };
  }

  if (!Array.isArray(raw.permissionCodes) || raw.permissionCodes.length > API_CLIENT_LIMITS.maxPermissions) {
    return { ok: false, error: 'Permisos no válidos' };
  }
  const permissionCodes: string[] = [];
  for (const code of raw.permissionCodes) {
    if (typeof code !== 'string' || !knownPermissions.has(code)) return { ok: false, error: 'Permisos no válidos' };
    if (!permissionCodes.includes(code)) permissionCodes.push(code);
  }
  if (!agentCode && permissionCodes.some(permissionRequiresAgentCode)) {
    return { ok: false, error: AGENT_CODE_REQUIRED_MESSAGE };
  }

  if (typeof raw.active !== 'boolean') return { ok: false, error: 'Indique si el cliente está activo' };

  const subject = parseSubjectRef(raw.clientType, raw.subjectRef);
  if (!subject.ok) return subject;

  // Nivel de acceso: ausente o null = solo lectura. Que no marque permisos de escritura en lectura
  // lo revisa validate.ts, que conoce el tipo de cada permiso del catálogo.
  let accessMode: ApiAccessMode = DEFAULT_API_ACCESS_MODE;
  if (raw.accessMode !== undefined && raw.accessMode !== null) {
    if (!isApiAccessMode(raw.accessMode)) return { ok: false, error: 'Nivel de acceso no válido' };
    accessMode = raw.accessMode;
  }

  // Permisos por empresa: solo de permisos marcados y en empresas del cliente. Lista vacía = todas.
  const usesApi = clientTypeUsesApiAccess(raw.clientType);
  const permissionCompanies = parsePermissionCompanies(raw.permissionCompanies, permissionCodes, allCompanies, companyIds);
  if (!permissionCompanies.ok) return permissionCompanies;

  return {
    ok: true,
    value: {
      name,
      clientType: raw.clientType,
      description,
      agentCode,
      allCompanies,
      companyIds: allCompanies ? [] : companyIds.sort((a, b) => a - b),
      // Sin acceso por API («Proveedor o cliente») no se guardan permisos aunque lleguen
      // (p. ej. alguien llama la API directo, o un cliente viejo que aún los tenía).
      permissionCodes: clientTypeUsesApiAccess(raw.clientType) ? permissionCodes.sort() : [],
      active: raw.active,
      subjectRef: subject.value,
      subjectLabel: null,
      accessMode,
      permissionCompanies: usesApi ? permissionCompanies.value : {},
    },
  };
}

function parsePermissionCompanies(
  value: unknown,
  permissionCodes: readonly string[],
  allCompanies: boolean,
  companyIds: readonly number[]
): ParseResult<Record<string, number[]>> {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Empresas por permiso no válidas' };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > API_CLIENT_LIMITS.maxPermissions) return { ok: false, error: 'Empresas por permiso no válidas' };
  const result: Record<string, number[]> = {};
  let total = 0;
  for (const [code, list] of entries) {
    if (!permissionCodes.includes(code)) return { ok: false, error: 'Empresas por permiso no válidas' };
    if (!Array.isArray(list) || list.length > API_CLIENT_LIMITS.maxCompanies) {
      return { ok: false, error: 'Empresas por permiso no válidas' };
    }
    const ids: number[] = [];
    for (const id of list) {
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return { ok: false, error: 'Empresas por permiso no válidas' };
      if (!allCompanies && !companyIds.includes(id)) return { ok: false, error: PERMISSION_COMPANY_OUTSIDE_MESSAGE };
      if (!ids.includes(id)) ids.push(id);
    }
    total += ids.length;
    if (total > API_CLIENT_LIMITS.maxPermissionCompanyEntries) return { ok: false, error: 'Demasiadas empresas por permiso' };
    if (ids.length > 0) result[code] = ids.sort((a, b) => a - b);
  }
  return { ok: true, value: result };
}

/** Código de agente de la ruta (`[code]`), con el mismo patrón que el cuerpo; en minúsculas. */
export function parseAgentCodeParam(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  return AGENT_CODE_PATTERN.test(code) ? code : null;
}

/** Id positivo de la ruta (`[id]`, `[keyId]`). */
export function parseRouteId(value: string | undefined): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}

/** ¿El cliente puede actuar en esa empresa? */
export function clientCoversCompany(scope: { allCompanies: boolean; companyIds: readonly number[] }, companyId: number): boolean {
  return scope.allCompanies || scope.companyIds.includes(companyId);
}
