/**
 * PERMISOS API — constantes PURAS sin `node:crypto` (las usa también la
 * pantalla, que corre en el navegador). Reglas con crypto: rules.ts.
 */

/**
 * Tipos de cliente, en el orden en que se muestran (secciones de la pestaña y
 * control segmentado del modal). «synerlink» = integraciones internas de
 * SynerLink (Orion, programador, SAPSEND…), 2026-11-09. La base los limita con
 * el CHECK `api_client_client_type_ck` (prisma/manual/2026-11-09-permisos-api-*.sql).
 */
/**
 * Permiso de gestión de la API SAP (2026-11-10): proceso «API SAP» → subproceso «Gestión de la API SAP».
 * Es una página real (/process/api-sap, sale en el menú). Entra quien lo tenga asignado; se asigna
 * desde Administración → Usuarios como cualquier subproceso (igual que Firmas).
 * Script: prisma/manual/2026-11-10-permisos-api-gestion-api-sap-*.sql.
 */
export const API_SAP_MANAGE_URL = '/process/api-sap';
export const API_SAP_PROCESS_NAME = 'API SAP';
export const API_SAP_MANAGE_SUBPROCESS_NAME = 'Gestión de la API SAP';

export function isApiSapManageSubprocess(subprocess: { subprocess_url?: string | null }): boolean {
  return (subprocess.subprocess_url ?? '').toLowerCase().trim().replace(/\/+$/, '') === API_SAP_MANAGE_URL;
}

export const API_CLIENT_TYPES = ['agente', 'mexico', 'portal_terceros', 'synerlink', 'otro'] as const;
export type ApiClientType = (typeof API_CLIENT_TYPES)[number];

/**
 * Tipos que se pueden elegir al crear (2026-11-10): sin «synerlink», porque una persona de
 * SynerLink no se conecta a la API SAP (sus permisos van por subprocesos). Se deja en
 * API_CLIENT_TYPES para no romper clientes que ya existan de ese tipo.
 */
export const API_CLIENT_SELECTABLE_TYPES: readonly ApiClientType[] = ['agente', 'mexico', 'portal_terceros', 'otro'];

/**
 * ¿El tipo se conecta por API (empresas, permisos y llaves)? «Proveedor o cliente» no:
 * de él solo se administra lo que ve en el portal de proveedores (2026-11-10).
 */
export function clientTypeUsesApiAccess(type: ApiClientType): boolean {
  return type !== 'portal_terceros';
}

export const API_CLIENT_TYPE_LABELS: Record<ApiClientType, string> = {
  agente: 'Agente de IA',
  mexico: 'México (casa matriz)',
  portal_terceros: 'Proveedor o cliente',
  synerlink: 'Usuario SynerLink',
  otro: 'Otro',
};

/** Etiqueta corta (selector de tipo del modal). */
export const API_CLIENT_TYPE_SHORT_LABELS: Record<ApiClientType, string> = {
  agente: 'Agente de IA',
  mexico: 'México',
  portal_terceros: 'Proveedor / cliente',
  synerlink: 'SynerLink',
  otro: 'Otro',
};

/** Una línea bajo el tipo elegido: qué significa esa identidad. */
export const API_CLIENT_TYPE_HINTS: Record<ApiClientType, string> = {
  agente: 'Un agente de IA (Zoe, Horus…). Le das rutas del MCP y una llave.',
  mexico: 'Una persona de casa matriz México, con su correo y su propia llave.',
  portal_terceros: 'Un proveedor o cliente de SAP: se administra lo que ve en el portal (no usa llave de API).',
  synerlink: 'Integración que actúa como un usuario de SynerLink.',
  otro: 'Otro sistema (Power Automate, n8n, Orion, SAPSEND…): elígelo de la lista.',
};

/** Filtros del listado unificado (2026-11-11). */
export const API_CLIENT_FILTERS = [
  { value: 'all' as const, label: 'Todos' },
  { value: 'agente' as const, label: 'Agentes' },
  { value: 'mexico' as const, label: 'México' },
  { value: 'portal_terceros' as const, label: 'Portal' },
  { value: 'otro' as const, label: 'Otros' },
];
export type ApiClientFilter = (typeof API_CLIENT_FILTERS)[number]['value'];

/** Título de la sección plegable de la pestaña (plural). */
export const API_CLIENT_TYPE_SECTION_TITLES: Record<ApiClientType, string> = {
  agente: 'Agentes de IA',
  mexico: 'México',
  portal_terceros: 'Proveedores o clientes',
  synerlink: 'Usuarios SynerLink',
  otro: 'Otros',
};

/**
 * Plataformas (`api_permission.system`) en las que un cliente puede tener permiso.
 * Hoy el catálogo solo tiene SynerLink (herramientas MCP); fase 2 sumará más.
 */
export const API_PERMISSION_SYSTEM_LABELS: Record<string, string> = {
  synerlink: 'SynerLink',
  portal_terceros: 'Portal de terceros',
  mexico: 'México',
  sap: 'SAP',
};

export function permissionSystemLabel(system: string): string {
  return API_PERMISSION_SYSTEM_LABELS[system] ?? system;
}
export function isApiClientType(value: unknown): value is ApiClientType {
  return typeof value === 'string' && (API_CLIENT_TYPES as readonly string[]).includes(value);
}

/**
 * Permisos que actúan «en nombre de» un agente: exigen `agent_code`.
 * - kronos_request_ia_access: mcp/src/config.ts (superRefine) y mcp/src/tools/iaAccess.ts.
 * - correo_*: mcp/src/correo/concesion.ts (codigoAgente: la concesión es para UN agente).
 * - proyecto*_: mcp/src/proyectos/nucleo.ts (codigoAgente: concesión o turno del agente).
 * Sin código, el MCP tomaría el NOMBRE del cliente como código: por eso se exige aquí
 * y además el MCP los descarta en llaves de la base sin código (mcp/src/auth.ts).
 */
export const PERMISSIONS_REQUIRING_AGENT_CODE: readonly string[] = [
  'kronos_request_ia_access',
  'correo_hilo_compartido',
  'correo_adjunto_compartido',
  'correo_proponer_respuesta',
  'correo_crear_solicitud_desde_hilo',
  'correo_agregar_nota',
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
];

const REQUIRING_AGENT_CODE = new Set(PERMISSIONS_REQUIRING_AGENT_CODE);

export function permissionRequiresAgentCode(code: string): boolean {
  return REQUIRING_AGENT_CODE.has(code);
}

/** Mensaje común (servidor y pantalla) cuando faltan el código de agente. */
export const AGENT_CODE_REQUIRED_MESSAGE =
  'Los permisos de Proyectos, Correo y «Solicitar conectores de IA» exigen elegir el agente';

export const API_CLIENT_LIMITS = {
  name: 120,
  description: 500,
  agentCode: 60,
  maxCompanies: 200,
  maxPermissions: 200,
  subjectRef: 120,
  subjectLabel: 200,
  systemName: 120,
  systemDescription: 500,
  /** Total de pares permiso × empresa (permisos por empresa). SQL Server admite 2100 parámetros por consulta. */
  maxPermissionCompanyEntries: 1000,
} as const;

/* ─────────────────────────────── Sujeto del cliente (2026-11-09) ─────────────────────────────── */

/**
 * «Sujeto» = a quién o a qué representa el cliente, elegido de una lista según el tipo
 * (columnas api_client.subject_ref / subject_label):
 *   - portal_terceros → la EMPRESA del tercero (NIT), socio de negocio de SAP (vía API SAP).
 *   - synerlink       → un USUARIO activo de SynerLink ([user].id).
 *   - otro            → un SISTEMA de api_external_system (id).
 *   - mexico          → una PERSONA de casa matriz (2026-11-10): subject_ref = su correo (en
 *                       minúsculas) y el nombre del cliente = su nombre. Una persona = una llave.
 *   - agente          → sin sujeto (el agente va en agent_code).
 */
export type ApiClientSubjectKind = 'tercero' | 'usuario' | 'sistema' | 'persona';

export const API_CLIENT_SUBJECT_KIND: Record<ApiClientType, ApiClientSubjectKind | null> = {
  agente: null,
  mexico: 'persona',
  portal_terceros: 'tercero',
  synerlink: 'usuario',
  otro: 'sistema',
};

export function subjectKindOf(type: ApiClientType): ApiClientSubjectKind | null {
  return API_CLIENT_SUBJECT_KIND[type];
}

export const API_CLIENT_SUBJECT_LABELS: Record<ApiClientSubjectKind, string> = {
  tercero: 'Tercero',
  usuario: 'Usuario',
  sistema: 'Sistema',
  persona: 'Persona',
};

/** Mensaje cuando falta elegir el sujeto (servidor y pantalla). */
export const API_CLIENT_SUBJECT_REQUIRED: Record<ApiClientSubjectKind, string> = {
  tercero: 'Elige el proveedor o cliente',
  usuario: 'Elige el usuario de SynerLink',
  sistema: 'Elige el sistema',
  persona: 'Agrega la persona de México (nombre y correo)',
};

/** Texto de una fila del panel: «Tercero: ABAMIA LABS · NIT 901724736», «Usuario: …», «Sistema: n8n». */
export function formatSubject(type: ApiClientType, ref: string | null, label: string | null): string | null {
  const kind = subjectKindOf(type);
  if (!kind || !ref) return null;
  const name = label?.trim() || null;
  if (kind === 'tercero') {
    return name && name !== ref ? `Tercero: ${name} · NIT ${ref}` : `Tercero: NIT ${ref}`;
  }
  // Persona de México: el nombre ya es el título de la fila; aquí va su correo.
  if (kind === 'persona') return `Correo: ${ref}`;
  return `${API_CLIENT_SUBJECT_LABELS[kind]}: ${name ?? ref}`;
}

/** Mensajes de proveedores y clientes (API SAP; la llamada sale solo del servidor de Kronos). */
export const PORTAL_TERCEROS_NOT_CONFIGURED_MESSAGE =
  'Falta configurar la conexión con la API SAP (SAP_API_URL y SAP_API_SYNERLINK_PRIVATE_KEY)';
export const PORTAL_TERCEROS_UNREACHABLE_MESSAGE = 'No se pudo confirmar el proveedor o cliente en SAP';
export const PORTAL_TERCEROS_SEARCH_ERROR_MESSAGE = 'No se pudo consultar la API SAP. Intenta de nuevo.';

/** Mensajes de «qué ve en el portal» (API de la landing). */
export const PORTAL_ACCESS_NOT_CONFIGURED_MESSAGE =
  'Falta configurar la conexión con la API del portal (PORTAL_TERCEROS_URL y PORTAL_TERCEROS_KEY)';
export const PORTAL_ACCESS_ERROR_MESSAGE = 'No se pudo consultar la API del portal. Intenta de nuevo.';

/* ─────────────────────────────── Vencimiento de llaves (2026-11-10) ─────────────────────────────── */

/**
 * Vigencias que se pueden elegir al generar una llave, en años (0 = no vence). Columna
 * api_client_key.expires_at (script 2026-11-10-permisos-api-vencimiento-llaves). Al vencer,
 * la llave deja de funcionar (Kronos y el MCP la ignoran) y hay que generar una nueva.
 */
export const API_KEY_VALIDITY_YEARS = [0, 1, 2, 3, 5] as const;
export type ApiKeyValidityYears = (typeof API_KEY_VALIDITY_YEARS)[number];

/** Vigencia sugerida al generar: México 2 años; los demás, sin vencimiento. */
export function defaultKeyValidityYears(type: ApiClientType): ApiKeyValidityYears {
  return type === 'mexico' ? 2 : 0;
}

export function keyValidityLabel(years: number): string {
  if (years === 0) return 'No vence';
  return years === 1 ? '1 año' : `${years} años`;
}

/** Valida la vigencia del cuerpo (ausente = 0, no vence). */
export function parseKeyValidityYears(value: unknown): ApiKeyValidityYears | null {
  if (value === undefined) return 0;
  return (API_KEY_VALIDITY_YEARS as readonly unknown[]).includes(value) ? (value as ApiKeyValidityYears) : null;
}

/** ¿La llave ya venció? (sin fecha = no vence). */
export function isKeyExpired(expiresAt: Date | string | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  return Number.isFinite(time) && time <= now;
}

/* ─────────────────────────────── Nivel de acceso (2026-11-11) ─────────────────────────────── */

/**
 * Qué puede hacer el cliente con la API (columna api_client.access_mode; NULL = lectura):
 *   - lectura: solo consulta. Los permisos de escritura no se pueden marcar.
 *   - escritura: además puede usar los permisos que escriben (api_permission.access_kind = 'escritura':
 *     crear solicitudes, notas, adjuntos, propuestas…).
 * Aplica a todos los tipos (agente, México, proveedor o cliente, otro). Script:
 * prisma/manual/2026-11-11-permisos-api-nivel-acceso-*.sql. El MCP tampoco carga permisos de
 * escritura de un cliente en lectura (mcp/src/dbKeys.ts).
 */
export const API_ACCESS_MODES = ['lectura', 'escritura'] as const;
export type ApiAccessMode = (typeof API_ACCESS_MODES)[number];
export const DEFAULT_API_ACCESS_MODE: ApiAccessMode = 'lectura';

export const API_ACCESS_MODE_LABELS: Record<ApiAccessMode, string> = {
  lectura: 'Solo lectura',
  escritura: 'Lectura y escritura',
};

export function isApiAccessMode(value: unknown): value is ApiAccessMode {
  return typeof value === 'string' && (API_ACCESS_MODES as readonly string[]).includes(value);
}

/** Valor de la base → nivel efectivo. NULL o cualquier valor raro = lectura (falla cerrado). */
export function normalizeApiAccessMode(value: unknown): ApiAccessMode {
  return value === 'escritura' ? 'escritura' : 'lectura';
}

/** Tipo de cada permiso del catálogo (api_permission.access_kind). */
export type ApiPermissionAccessKind = 'consulta' | 'escritura';

export function normalizePermissionAccessKind(value: unknown): ApiPermissionAccessKind {
  return value === 'escritura' ? 'escritura' : 'consulta';
}

export const WRITE_PERMISSION_NEEDS_WRITE_MODE_MESSAGE =
  'Para marcar permisos de escritura activa «Permitir escritura» en este cliente';

/* ─────────────────────────────── Copiar permisos a otros clientes (2026-11-11) ─────────────────────────────── */

export interface PermissionCopyTarget {
  clientType: ApiClientType;
  accessMode: ApiAccessMode;
  agentCode: string | null;
}

export interface PermissionCopyResult {
  /** Lo que de verdad recibe el cliente. */
  codes: string[];
  /** Se quitaron por ser de escritura y el cliente está en solo lectura. */
  droppedWrite: string[];
  /** Se quitaron porque actúan en nombre de un agente y el cliente no tiene agente. */
  droppedAgent: string[];
}

/** Máximo de clientes que reciben los permisos en una sola copia. */
export const MAX_PERMISSION_COPY_TARGETS = 100;

/**
 * Qué permisos recibe un cliente al copiarle los de otro (servidor y vista previa de la pantalla).
 * Se respetan SUS reglas: en solo lectura no recibe los de escritura, sin agente no recibe los que
 * exigen agente, y un «Proveedor o cliente» no recibe permisos de API (se maneja en su portal).
 */
export function permissionsForCopy(
  codes: readonly string[],
  target: PermissionCopyTarget,
  writeCodes: ReadonlySet<string>
): PermissionCopyResult {
  if (!clientTypeUsesApiAccess(target.clientType)) return { codes: [], droppedWrite: [], droppedAgent: [] };
  const droppedWrite: string[] = [];
  const droppedAgent: string[] = [];
  const result: string[] = [];
  for (const code of [...new Set(codes)].sort()) {
    if (target.accessMode !== 'escritura' && writeCodes.has(code)) droppedWrite.push(code);
    else if (!target.agentCode && permissionRequiresAgentCode(code)) droppedAgent.push(code);
    else result.push(code);
  }
  return { codes: result, droppedWrite, droppedAgent };
}

/* ─────────────────────────────── Permisos por empresa (2026-11-11) ─────────────────────────────── */

/**
 * Plataformas cuyos permisos se pueden limitar a algunas empresas del cliente. Por ahora solo SAP:
 * el MCP de SynerLink filtra por las empresas del cliente, no por permiso.
 */
export const PER_COMPANY_PERMISSION_SYSTEMS: readonly string[] = ['sap'];

export const PERMISSION_COMPANY_OUTSIDE_MESSAGE = 'Un permiso tiene una empresa que este cliente no tiene marcada';
export const PERMISSION_COMPANY_SYSTEM_MESSAGE = 'Solo los permisos de SAP se pueden limitar por empresa';
