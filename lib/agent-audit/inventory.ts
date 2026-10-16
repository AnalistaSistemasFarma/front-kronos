/**
 * INVENTARIO DE AGENTES (Auditoría de agentes → Inventario, F1) — parte PURA.
 *
 * Aquí vive todo lo que decide qué se acepta del recolector y qué riesgos salen
 * de un inventario, sin Prisma ni red, para poder probarlo con vitest (mismo
 * criterio que lib/chat/agent-keys.ts). La escritura en base está en
 * app/api/chat/auditoria/inventario/route.ts.
 *
 * NUNCA SE GUARDAN SECRETOS (decisión de Nicolás, 2026-10-02). El recolector ya
 * manda solo nombres, destinos y "exige autenticación sí/no"; aun así, todo
 * texto que entra pasa por `ocultarSecretos` como segunda barrera: si algún día
 * el recolector se equivoca, lo que parezca una credencial no llega a la base.
 */

export const KINDS = ['claude-code', 'openclaw'] as const;
export const SERVICE_STATUS = ['activo', 'detenido', 'sin-servicio', 'desconocido'] as const;
export const EXEC_MODES = [
  'sin-aprobacion',
  'con-aprobacion',
  'restringido',
  'desconocido',
] as const;
export const MCP_TRANSPORTS = ['http', 'stdio', 'sse', 'desconocido'] as const;
export const MCP_ACCESS = ['lectura', 'escritura', 'desconocido'] as const;
export const MCP_AUTH = ['requerida', 'ninguna', 'local', 'desconocida'] as const;
export const CHANNEL_POLICIES = [
  'lista-blanca',
  'emparejamiento',
  'abierta',
  'desconocida',
] as const;
export const SEVERITIES = ['critico', 'alto', 'medio', 'bajo'] as const;

export type Severity = (typeof SEVERITIES)[number];

export interface InventoryMcp {
  name: string;
  transport: (typeof MCP_TRANSPORTS)[number];
  target: string | null;
  company: string | null;
  access: (typeof MCP_ACCESS)[number];
  auth: (typeof MCP_AUTH)[number];
  writeTools: string[];
}

export interface InventoryChannel {
  /** 'telegram' | 'synerlink' | 'teams' | 'whatsapp' | … */
  type: string;
  policy: (typeof CHANNEL_POLICIES)[number];
  /** Cuántas personas o grupos están autorizados (sin sus ids). */
  allowed: number | null;
  detail: string | null;
}

export interface InventoryAgent {
  code: string;
  kind: (typeof KINDS)[number];
  host: string;
  location: string | null;
  model: string | null;
  serviceStatus: (typeof SERVICE_STATUS)[number];
  execMode: (typeof EXEC_MODES)[number];
  execRequiresApproval: boolean | null;
  tools: { allow: string[]; deny: string[] };
  skills: string[];
  channels: InventoryChannel[];
  mcps: InventoryMcp[];
  error: string | null;
}

export interface InventoryPayload {
  scanRequestId: number | null;
  collectorHost: string;
  startedAt: Date | null;
  errors: string[];
  agents: InventoryAgent[];
}

/** Topes: un payload fuera de esto no es un inventario, es un error o un abuso. */
export const LIMITS = {
  agents: 200,
  mcpsPorAgente: 100,
  skillsPorAgente: 600,
  herramientas: 300,
  canales: 30,
  errores: 100,
} as const;

// ── Barrera contra secretos ──────────────────────────────────────────────────

const OCULTO = '<oculto>';

/**
 * Patrones de credenciales conocidas. Se reemplazan por `<oculto>`.
 * Mejor ocultar de más (un nombre raro que parece llave) que guardar de menos.
 */
const PATRONES_SECRETOS: RegExp[] = [
  /Bearer\s+\S+/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, // Anthropic / OpenAI / Stripe
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g, // Slack
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWT
  /\b\d{6,12}:AA[A-Za-z0-9_-]{20,}/g, // token de bot de Telegram
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS
  /\b[A-Fa-f0-9]{32,}\b/g, // hex largo (llaves, hashes completos)
  // base64/url-safe largo con letras Y dígitos (sin '/', para no comerse rutas).
  /\b(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[A-Za-z])[A-Za-z0-9+_-]{40,}={0,2}/g,
];

/** `usuario:clave@host` → `host`; y parámetros de consulta sensibles. */
function limpiarUrl(s: string): string {
  return s
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1')
    .replace(
      /([?&;](?:token|key|apikey|api_key|secret|password|pwd|access_token|auth|sig)=)[^&;\s]*/gi,
      `$1${OCULTO}`
    );
}

/** Oculta todo lo que parezca una credencial dentro de un texto. */
export function ocultarSecretos(valor: string): string {
  let s = limpiarUrl(valor);
  for (const re of PATRONES_SECRETOS) s = s.replace(re, OCULTO);
  return s;
}

// ── Validación ───────────────────────────────────────────────────────────────

export class InventoryValidationError extends Error {}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = ocultarSecretos(v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim());
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function enumerado<T extends readonly string[]>(
  v: unknown,
  permitidos: T,
  porDefecto: T[number]
): T[number] {
  return typeof v === 'string' && (permitidos as readonly string[]).includes(v)
    ? (v as T[number])
    : porDefecto;
}

function listaTextos(v: unknown, tope: number, max = 120): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const x of v) {
    const t = texto(x, max);
    if (t && !vistos.has(t)) {
      vistos.add(t);
      out.push(t);
    }
    if (out.length >= tope) break;
  }
  return out;
}

/**
 * Destino de un MCP: se queda con esquema, host, puerto y ruta. Sin consulta,
 * sin fragmento y sin usuario/clave: ahí es donde se cuelan las llaves.
 */
export function limpiarDestino(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) return null;
  const sinConsulta = t.split(/[?#]/)[0];
  return texto(sinConsulta, 300);
}

function parseMcp(v: unknown): InventoryMcp | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const name = texto(o.name, 120);
  if (!name) return null;
  return {
    name,
    transport: enumerado(o.transport, MCP_TRANSPORTS, 'desconocido'),
    target: limpiarDestino(o.target),
    company: texto(o.company, 120),
    access: enumerado(o.access, MCP_ACCESS, 'desconocido'),
    auth: enumerado(o.auth, MCP_AUTH, 'desconocida'),
    writeTools: listaTextos(o.writeTools, 60, 80),
  };
}

function parseCanal(v: unknown): InventoryChannel | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const type = texto(o.type, 40);
  if (!type) return null;
  const allowed =
    typeof o.allowed === 'number' && Number.isFinite(o.allowed)
      ? Math.max(0, Math.trunc(o.allowed))
      : null;
  return {
    type: type.toLowerCase(),
    policy: enumerado(o.policy, CHANNEL_POLICIES, 'desconocida'),
    allowed,
    detail: texto(o.detail, 200),
  };
}

function parseAgente(v: unknown): InventoryAgent {
  if (typeof v !== 'object' || v === null)
    throw new InventoryValidationError('Cada agente debe ser un objeto.');
  const o = v as Record<string, unknown>;
  const code = texto(o.code, 60);
  if (!code || !/^[a-z0-9_.-]+$/i.test(code))
    throw new InventoryValidationError('Agente sin "code" válido.');
  const host = texto(o.host, 120);
  if (!host) throw new InventoryValidationError(`El agente "${code}" no trae "host".`);
  const tools = (typeof o.tools === 'object' && o.tools !== null ? o.tools : {}) as Record<
    string,
    unknown
  >;
  const mcps = (Array.isArray(o.mcps) ? o.mcps : [])
    .slice(0, LIMITS.mcpsPorAgente)
    .map(parseMcp)
    .filter((x): x is InventoryMcp => x !== null);
  const channels = (Array.isArray(o.channels) ? o.channels : [])
    .slice(0, LIMITS.canales)
    .map(parseCanal)
    .filter((x): x is InventoryChannel => x !== null);
  const execRequiresApproval =
    typeof o.execRequiresApproval === 'boolean' ? o.execRequiresApproval : null;
  return {
    code: code.toLowerCase(),
    kind: enumerado(o.kind, KINDS, 'claude-code'),
    host,
    location: texto(o.location, 300),
    model: texto(o.model, 120),
    serviceStatus: enumerado(o.serviceStatus, SERVICE_STATUS, 'desconocido'),
    execMode: enumerado(o.execMode, EXEC_MODES, 'desconocido'),
    execRequiresApproval,
    tools: {
      allow: listaTextos(tools.allow, LIMITS.herramientas),
      deny: listaTextos(tools.deny, LIMITS.herramientas),
    },
    skills: listaTextos(o.skills, LIMITS.skillsPorAgente),
    channels,
    mcps,
    error: texto(o.error, 500),
  };
}

/** Valida y normaliza lo que publica el recolector. Lanza InventoryValidationError. */
export function parseInventoryPayload(body: unknown): InventoryPayload {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InventoryValidationError('El cuerpo debe ser un objeto JSON.');
  }
  const o = body as Record<string, unknown>;
  if (!Array.isArray(o.agents)) throw new InventoryValidationError('Falta la lista "agents".');
  if (o.agents.length > LIMITS.agents) {
    throw new InventoryValidationError(`Demasiados agentes (máximo ${LIMITS.agents}).`);
  }
  const collector = (
    typeof o.collector === 'object' && o.collector !== null ? o.collector : {}
  ) as Record<string, unknown>;
  const scanRequestId =
    typeof o.scanRequestId === 'number' && Number.isInteger(o.scanRequestId) && o.scanRequestId > 0
      ? o.scanRequestId
      : null;
  const started = typeof o.startedAt === 'string' ? new Date(o.startedAt) : null;

  const agentes = o.agents.map(parseAgente);
  // Un mismo agente dos veces en una corrida es un error del recolector: se
  // queda la primera aparición para no duplicar hallazgos.
  const vistos = new Set<string>();
  const agents = agentes.filter((a) => (vistos.has(a.code) ? false : (vistos.add(a.code), true)));

  return {
    scanRequestId,
    collectorHost: texto(collector.host, 120) ?? 'desconocido',
    startedAt: started && !Number.isNaN(started.getTime()) ? started : null,
    errors: listaTextos(o.errors, LIMITS.errores, 300),
    agents,
  };
}

// ── Reglas de riesgo automáticas ─────────────────────────────────────────────

export interface FindingDraft {
  ruleCode: string;
  severity: Severity;
  subject: string;
  title: string;
  detail: string | null;
}

/**
 * Hallazgos que salen de un inventario. Reglas deliberadamente pocas y
 * verificables, alineadas con la auditoría del 2026-09-28 (H-01 exec sin
 * aprobación; MCP centrales sin Bearer).
 */
export function evaluarHallazgos(a: InventoryAgent): FindingDraft[] {
  const out: FindingDraft[] = [];

  if (a.error) {
    out.push({
      ruleCode: 'escaneo-incompleto',
      severity: 'bajo',
      subject: '',
      title: 'No se pudo leer el agente en el último escaneo',
      detail: a.error,
    });
    // Sin lectura no hay con qué evaluar lo demás.
    return out;
  }

  if (a.execRequiresApproval === false) {
    out.push({
      ruleCode: 'exec-sin-aprobacion',
      severity: 'alto',
      subject: '',
      title: 'Ejecuta comandos del sistema sin pedir aprobación',
      detail:
        a.kind === 'openclaw'
          ? 'La ejecución de comandos de openclaw está en modo completo (equivale a omitir permisos).'
          : 'El agente arranca omitiendo los permisos de Claude Code (bypassPermissions o --dangerously-skip-permissions).',
    });
  }

  for (const m of a.mcps) {
    const donde = [m.target, m.company].filter(Boolean).join(' · ');
    if (m.auth === 'ninguna' && m.access === 'escritura') {
      out.push({
        ruleCode: 'mcp-escritura-sin-auth',
        severity: 'critico',
        subject: m.name,
        title: `MCP «${m.name}» puede escribir y no exige autenticación`,
        detail: `${donde ? `${donde}. ` : ''}Herramientas de escritura: ${m.writeTools.join(', ') || 'detectadas'}. Cualquiera en la red puede usarlo.`,
      });
    } else if (m.auth === 'ninguna') {
      out.push({
        ruleCode: 'mcp-sin-auth',
        severity: 'medio',
        subject: m.name,
        title: `MCP «${m.name}» no exige autenticación`,
        detail: `${donde ? `${donde}. ` : ''}Es de lectura, pero cualquiera en la red puede consultarlo.`,
      });
    } else if (m.access === 'escritura') {
      out.push({
        ruleCode: 'mcp-escritura',
        severity: 'bajo',
        subject: m.name,
        title: `MCP «${m.name}» tiene herramientas de escritura`,
        detail: `${donde ? `${donde}. ` : ''}Revisar si el rol del agente necesita escribir (mínimo privilegio).`,
      });
    }
  }

  for (const c of a.channels) {
    if (c.policy === 'abierta') {
      out.push({
        ruleCode: 'canal-abierto',
        severity: 'medio',
        subject: c.type,
        title: `Canal ${c.type} abierto a cualquier persona`,
        detail:
          'El canal no restringe quién le puede escribir al agente (sin lista blanca ni emparejamiento).',
      });
    }
  }

  return out;
}

/** Orden de severidad para mostrar y para resumir. */
export function pesoSeveridad(s: string): number {
  const i = (SEVERITIES as readonly string[]).indexOf(s);
  return i === -1 ? SEVERITIES.length : i;
}
