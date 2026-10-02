/**
 * HOJA DE VIDA DE LOS AGENTES (Auditoría de agentes, F2) — lógica PURA, sin
 * base de datos: días en hora de Colombia, deduplicación del consumo, cambios
 * entre dos inventarios, validación del perfil y del resumen semanal.
 *
 * La parte que toca Prisma está en ./cv-db.ts.
 */

/** Colombia no tiene horario de verano: UTC−5 todo el año. */
export const OFFSET_COLOMBIA_MS = 5 * 60 * 60 * 1000;

/** Día calendario en Colombia ('YYYY-MM-DD') de un instante. */
export function diaColombia(d: Date): string {
  return new Date(d.getTime() - OFFSET_COLOMBIA_MS).toISOString().slice(0, 10);
}

/** Instante UTC en que empieza un día de Colombia ('YYYY-MM-DD'). */
export function inicioDiaColombia(dia: string): Date {
  return new Date(new Date(`${dia}T00:00:00.000Z`).getTime() + OFFSET_COLOMBIA_MS);
}

/** Suma días a un 'YYYY-MM-DD'. */
export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana (Colombia) a la que pertenece un día. */
export function lunesDe(dia: string): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  return sumarDias(dia, -dow);
}

export function esDia(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw));
}

// ── Consumo ──────────────────────────────────────────────────────────────────

export interface FilaConsumo {
  id: number;
  id_agent: number;
  session_id: string | null;
  turn_started_at: Date | null;
  created_at: Date;
  input_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/**
 * Un turno que atendió varias conversaciones se reporta UNA VEZ POR
 * CONVERSACIÓN con la misma cifra (app/api/chat/agent/usage/route.ts), y se
 * reconoce por el mismo session_id + turn_started_at. Aquí cuenta una sola vez.
 * Sin esos dos datos no hay cómo reconocerlo: la fila cuenta sola.
 */
export function deduplicarTurnos(filas: FilaConsumo[]): FilaConsumo[] {
  const vistos = new Map<string, FilaConsumo>();
  for (const f of filas) {
    const clave =
      f.session_id && f.turn_started_at
        ? `${f.id_agent}|${f.session_id}|${f.turn_started_at.toISOString()}`
        : `fila|${f.id}`;
    const previa = vistos.get(clave);
    // Si dos reportes del mismo turno no coinciden, se queda el mayor: es la
    // lectura conservadora (no se esconde consumo).
    if (!previa || f.total_tokens > previa.total_tokens) vistos.set(clave, f);
  }
  return [...vistos.values()];
}

export interface ConsumoDia {
  turns: number;
  input_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/** Consumo deduplicado, sumado por agente y día de Colombia (clave 'id|día'). */
export function consumoPorDia(filas: FilaConsumo[]): Map<string, ConsumoDia> {
  const r = new Map<string, ConsumoDia>();
  for (const f of deduplicarTurnos(filas)) {
    const clave = `${f.id_agent}|${diaColombia(f.turn_started_at ?? f.created_at)}`;
    const c = r.get(clave) ?? {
      turns: 0,
      input_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
    c.turns += 1;
    c.input_tokens += f.input_tokens;
    c.cache_creation_tokens += f.cache_creation_tokens;
    c.cache_read_tokens += f.cache_read_tokens;
    c.output_tokens += f.output_tokens;
    c.total_tokens += f.total_tokens;
    r.set(clave, c);
  }
  return r;
}

// ── Cambios de inventario ────────────────────────────────────────────────────

export interface FotoInventario {
  kind: string;
  host: string;
  model: string | null;
  execMode: string | null;
  execRequiresApproval: boolean | null;
  tools: { allow: string[]; deny: string[] };
  skills: string[];
  channels: { type: string; policy: string }[];
  mcps: { name: string; access: string; auth: string; company: string | null }[];
}

function lista(items: string[], max = 8): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} y ${items.length - max} más`;
}

function diferencia(a: string[], b: string[]): { agregados: string[]; quitados: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    agregados: [...sb].filter((x) => !sa.has(x)).sort(),
    quitados: [...sa].filter((x) => !sb.has(x)).sort(),
  };
}

const NOMBRE_ACCESO: Record<string, string> = {
  escritura: 'escritura',
  lectura: 'lectura',
  desconocido: 'acceso sin determinar',
};
const NOMBRE_AUTH: Record<string, string> = {
  ninguna: 'sin autenticación',
  requerida: 'con autenticación',
  local: 'local',
  desconocida: 'autenticación sin determinar',
};

/** Frase corta con lo que tiene el agente (para el primer inventario). */
export function describirInventario(f: FotoInventario): string {
  const escritura = f.mcps.filter((m) => m.access === 'escritura').length;
  const partes = [
    `${f.mcps.length} ${f.mcps.length === 1 ? 'MCP' : 'MCP'}${escritura > 0 ? ` (${escritura} con escritura)` : ''}`,
    `${f.skills.length} ${f.skills.length === 1 ? 'skill' : 'skills'}`,
    `${f.channels.length} ${f.channels.length === 1 ? 'canal' : 'canales'}`,
  ];
  return `Corre en ${f.host}${f.model ? ` con el modelo ${f.model}` : ''}: ${partes.join(', ')}.`;
}

/**
 * Cambios entre dos fotos del inventario de un mismo agente, en frases cortas
 * y legibles. Vacío = no cambió nada que importe.
 */
export function diffInventarios(prev: FotoInventario, next: FotoInventario): string[] {
  const cambios: string[] = [];

  if (prev.host !== next.host) cambios.push(`Cambió de equipo: de ${prev.host} a ${next.host}.`);
  if ((prev.model ?? '') !== (next.model ?? '')) {
    cambios.push(`Cambió el modelo: de ${prev.model ?? 'sin dato'} a ${next.model ?? 'sin dato'}.`);
  }
  if (prev.execRequiresApproval !== next.execRequiresApproval || (prev.execMode ?? '') !== (next.execMode ?? '')) {
    const como = (v: boolean | null) =>
      v === false ? 'sin aprobación' : v ? 'con aprobación' : 'sin determinar';
    cambios.push(
      `Cambió la ejecución de comandos: de ${como(prev.execRequiresApproval)} a ${como(next.execRequiresApproval)}.`
    );
  }

  const mcpPrev = new Map(prev.mcps.map((m) => [m.name, m]));
  const mcpNext = new Map(next.mcps.map((m) => [m.name, m]));
  const dm = diferencia([...mcpPrev.keys()], [...mcpNext.keys()]);
  if (dm.agregados.length) cambios.push(`MCP nuevos: ${lista(dm.agregados)}.`);
  if (dm.quitados.length) cambios.push(`MCP retirados: ${lista(dm.quitados)}.`);
  for (const [nombre, m] of mcpNext) {
    const p = mcpPrev.get(nombre);
    if (!p) continue;
    // 'desconocido'/'desconocida' = el sondeo no pudo saberlo en esa corrida
    // (p. ej. el MCP no respondió a tiempo). No es un cambio real: contarlo
    // llenaría el historial de idas y vueltas.
    if (p.access !== m.access && p.access !== 'desconocido' && m.access !== 'desconocido') {
      cambios.push(
        `${nombre} pasó de ${NOMBRE_ACCESO[p.access] ?? p.access} a ${NOMBRE_ACCESO[m.access] ?? m.access}.`
      );
    }
    if (p.auth !== m.auth && p.auth !== 'desconocida' && m.auth !== 'desconocida') {
      cambios.push(`${nombre} pasó de ${NOMBRE_AUTH[p.auth] ?? p.auth} a ${NOMBRE_AUTH[m.auth] ?? m.auth}.`);
    }
  }

  const ds = diferencia(prev.skills, next.skills);
  if (ds.agregados.length) cambios.push(`Skills nuevos: ${lista(ds.agregados)}.`);
  if (ds.quitados.length) cambios.push(`Skills retirados: ${lista(ds.quitados)}.`);

  const canal = (c: { type: string; policy: string }) => `${c.type} (${c.policy})`;
  const dc = diferencia(prev.channels.map(canal), next.channels.map(canal));
  if (dc.agregados.length || dc.quitados.length) {
    cambios.push(
      `Cambiaron los canales${dc.agregados.length ? `; ahora: ${lista(dc.agregados)}` : ''}${dc.quitados.length ? `; antes: ${lista(dc.quitados)}` : ''}.`
    );
  }

  const ta = diferencia(prev.tools.allow, next.tools.allow);
  const td = diferencia(prev.tools.deny, next.tools.deny);
  if (ta.agregados.length) cambios.push(`Herramientas permitidas nuevas: ${lista(ta.agregados)}.`);
  if (ta.quitados.length) cambios.push(`Herramientas que dejaron de estar permitidas: ${lista(ta.quitados)}.`);
  if (td.agregados.length) cambios.push(`Herramientas negadas nuevas: ${lista(td.agregados)}.`);
  if (td.quitados.length) cambios.push(`Herramientas que dejaron de estar negadas: ${lista(td.quitados)}.`);

  return cambios;
}

// ── Hallazgos agrupados ──────────────────────────────────────────────────────

const PLURAL: Record<string, [string, string]> = {
  critico: ['crítico', 'críticos'],
  alto: ['alto', 'altos'],
  medio: ['medio', 'medios'],
  bajo: ['bajo', 'bajos'],
};

/** "2 críticos y 1 alto" a partir de una lista de severidades. */
export function contarSeveridades(sev: string[]): string {
  const orden = ['critico', 'alto', 'medio', 'bajo'];
  const partes = orden
    .map((s) => {
      const n = sev.filter((x) => x === s).length;
      if (n === 0) return null;
      const [uno, varios] = PLURAL[s];
      return `${n} ${n === 1 ? uno : varios}`;
    })
    .filter((x): x is string => Boolean(x));
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

export function tituloHallazgos(tipo: 'abre' | 'cierra', sev: string[]): string {
  const n = sev.length;
  const que = n === 1 ? 'hallazgo' : 'hallazgos';
  const verbo =
    tipo === 'abre' ? (n === 1 ? 'Se abrió' : 'Se abrieron') : n === 1 ? 'Se cerró' : 'Se cerraron';
  return `${verbo} ${n} ${que} (${contarSeveridades(sev)})`;
}

// ── Perfil (propósito y dueño) ───────────────────────────────────────────────

export class PerfilInvalidoError extends Error {}

export interface PerfilEntrada {
  purpose: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
}

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function textoOpcional(raw: unknown, max: number, campo: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new PerfilInvalidoError(`${campo}: debe ser texto.`);
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > max) throw new PerfilInvalidoError(`${campo}: máximo ${max} caracteres.`);
  return t;
}

export function validarPerfil(body: unknown): PerfilEntrada {
  if (!body || typeof body !== 'object') throw new PerfilInvalidoError('El cuerpo debe ser un objeto JSON.');
  const b = body as Record<string, unknown>;
  const purpose = textoOpcional(b.purpose, 1000, 'Propósito');
  const ownerName = textoOpcional(b.ownerName, 160, 'Dueño');
  const ownerEmail = textoOpcional(b.ownerEmail, 255, 'Correo del dueño');
  if (ownerEmail && !RE_CORREO.test(ownerEmail)) {
    throw new PerfilInvalidoError('Correo del dueño: no tiene formato de correo.');
  }
  return { purpose, ownerName, ownerEmail: ownerEmail?.toLowerCase() ?? null };
}

/** Frases del cambio de perfil, para la línea de tiempo. */
export function cambiosPerfil(antes: PerfilEntrada | null, despues: PerfilEntrada): string[] {
  const a = antes ?? { purpose: null, ownerName: null, ownerEmail: null };
  const c: string[] = [];
  if ((a.purpose ?? '') !== (despues.purpose ?? '')) {
    c.push(despues.purpose ? 'Se actualizó el propósito.' : 'Se borró el propósito.');
  }
  if ((a.ownerName ?? '') !== (despues.ownerName ?? '') || (a.ownerEmail ?? '') !== (despues.ownerEmail ?? '')) {
    const quien = [despues.ownerName, despues.ownerEmail].filter(Boolean).join(' · ');
    c.push(quien ? `Dueño: ${quien}.` : 'Se quitó el dueño.');
  }
  return c;
}

// ── Resumen semanal ──────────────────────────────────────────────────────────

export class ResumenInvalidoError extends Error {}

export const MAX_RESUMEN = 2500;

/**
 * Limpia el texto que devuelve la IA: sin encabezados Markdown ni viñetas
 * sueltas al principio, espacios normalizados y con tope de largo.
 */
export function limpiarResumen(raw: unknown): string {
  if (typeof raw !== 'string') throw new ResumenInvalidoError('El resumen debe ser texto.');
  const t = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*#+\s*/, '').replace(/\*\*/g, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length < 40) throw new ResumenInvalidoError('El resumen está vacío o es demasiado corto.');
  if (t.length > MAX_RESUMEN) throw new ResumenInvalidoError(`El resumen supera ${MAX_RESUMEN} caracteres.`);
  return t;
}
