/**
 * El agente LEE SUS PROYECTOS desde su CHAT NORMAL (2026-11-06, pedido de
 * Nicolás Rivera). Caso que lo originó: Kepler negó desde su chat un PR que sí
 * abrió en su proyecto 22, porque la sesión del chat no sabe nada de los hilos
 * de proyecto (cada hilo tiene su propia sesión en el puente de hilos).
 *
 * SOLO LECTURA. Sin concesión: la identidad sale del MENSAJE que el agente está
 * atendiendo (conversación + mensaje que le llegaron por el canal), y el
 * servidor la verifica:
 *   - el mensaje existe, es de esa conversación, lo escribió una PERSONA y es
 *     reciente (MAX_HORAS_TURNO);
 *   - la conversación es del CHAT NORMAL del agente de la LLAVE: 'direct' con
 *     ese agente y esa persona, o un 'group' donde el mensaje le fue ENTREGADO a
 *     ese agente (chat_message_delivery). Nunca un hilo de proyecto ni uno
 *     entre personas;
 *   - la persona está activa y no es proveedor.
 * Luego, cada lectura pasa la MISMA puerta de la concesión (miembro del
 * proyecto + permiso del módulo en su empresa + proyecto activo) y, además,
 * exige que ESTE agente esté designado en el proyecto. Si la persona del turno
 * no tiene acceso: «No autorizado».
 *
 * El modelo no puede escoger a nombre de quién lee: solo pasa los ids que le
 * llegaron; la persona la deduce el servidor del mensaje. Riesgo residual
 * (documentado): un agente podría pasar el id de OTRO mensaje reciente de su
 * propio chat; el tope de horas y la auditoría lo acotan.
 */
import { Prisma } from '../db.js';
import type { AuthScope } from '../auth.js';
import {
  auditarProyecto,
  codigoAgente,
  ProyectosRechazo,
  type AgenteFila,
  type ConcesionProyectos,
  type Lector,
} from './nucleo.js';
import { queryReadOnly } from '../db.js';

export const RECHAZO_TURNO =
  'No autorizado: no pude comprobar quién le escribe. Use el conversation_id y el message_id EXACTOS del mensaje que está atendiendo (los trae la cabecera del canal de SynerLink).';

/** Horas que un mensaje sirve como prueba de «quién me escribe en este turno». */
export function maxHorasTurno(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PROYECTOS_TURNO_MAX_HORAS ?? '');
  return Number.isFinite(n) && n >= 1 && n <= 72 ? Math.floor(n) : 6;
}

/** Tope de mensajes por llamada de proyecto_historial. */
export const MAX_MENSAJES_HISTORIAL = 100;
/** Tope de caracteres de cada mensaje del historial. */
export const MAX_CHARS_MENSAJE = 4_000;

function q(db?: Lector) {
  return <T>(sql: Prisma.Sql) => (db ? (db.$queryRaw<T[]>(sql) as Promise<T[]>) : queryReadOnly<T>(sql));
}

export interface FilaTurno {
  id_conversation: number;
  kind: string;
  conv_agent: number;
  conv_user: string;
  conv_archived: boolean | number;
  role: string;
  id_user_author: string | null;
  reciente: number | boolean;
  entregado_al_agente: number;
  name: string | null;
  email: string | null;
  isActive: boolean | number | null;
  user_role: string | null;
}

/** Regla PURA: ¿el mensaje prueba quién le escribe a este agente en su chat normal? Devuelve el motivo del rechazo o null. */
export function motivoRechazoTurno(f: FilaTurno | undefined, idAgent: number): string | null {
  if (!f) return 'el mensaje no existe en esa conversación';
  if (f.kind !== 'direct' && f.kind !== 'group') return `la conversación es de tipo «${f.kind}», no del chat normal`;
  if (f.conv_archived === true || f.conv_archived === 1) return 'la conversación está archivada';
  if (f.role !== 'user' || !f.id_user_author) return 'el mensaje no lo escribió una persona';
  if (!(f.reciente === 1 || f.reciente === true)) return 'el mensaje es antiguo';
  if (f.kind === 'direct') {
    if (Number(f.conv_agent) !== Number(idAgent)) return 'la conversación es de otro agente';
    if (f.conv_user !== f.id_user_author) return 'el autor no es la persona de la conversación';
  } else if (!(Number(f.entregado_al_agente) > 0)) {
    return 'el mensaje del grupo no se le entregó a este agente';
  }
  if (f.isActive === false || f.isActive === 0 || f.user_role === 'supplier') return 'la persona está inactiva';
  return null;
}

/**
 * Resuelve la persona del TURNO para el agente de la llave. Cualquier falla →
 * el mismo rechazo (no confirma si el mensaje existe).
 */
export async function resolverTurnoProyectos(
  scope: AuthScope,
  idConversation: number,
  idMessage: number,
  db?: Lector
): Promise<{ agente: AgenteFila; concesion: ConcesionProyectos }> {
  const leer = q(db);
  const code = codigoAgente(scope);
  if (!code) throw new ProyectosRechazo('Esta llave no identifica a un agente de SynerLink.');
  const agentes = await leer<AgenteFila>(Prisma.sql`
    SELECT TOP 1 a.id_agent, a.code, a.display_name, a.id_subprocess FROM agent a WHERE LOWER(a.code) = ${code} AND a.is_active = 1
  `);
  const agente = agentes[0];
  if (!agente) throw new ProyectosRechazo('Esta llave no identifica a un agente activo de SynerLink.');
  if (!Number.isInteger(idConversation) || idConversation <= 0 || !Number.isInteger(idMessage) || idMessage <= 0) {
    throw new ProyectosRechazo(RECHAZO_TURNO);
  }
  const horas = maxHorasTurno();
  const filas = await leer<FilaTurno>(Prisma.sql`
    SELECT TOP 1 c.id AS id_conversation, c.kind, c.id_agent AS conv_agent, c.id_user AS conv_user, c.archived AS conv_archived,
      m.role, m.id_user_author,
      CASE WHEN m.created_at > DATEADD(HOUR, ${-horas}, SYSUTCDATETIME()) THEN 1 ELSE 0 END AS reciente,
      (SELECT COUNT(1) FROM chat_message_delivery d WHERE d.id_message = m.id AND d.id_agent = ${agente.id_agent}) AS entregado_al_agente,
      u.name, u.email, u.isActive, u.role AS user_role
    FROM chat_message m
    INNER JOIN chat_conversation c ON c.id = m.id_conversation
    LEFT JOIN [user] u ON u.id = m.id_user_author
    WHERE m.id = ${idMessage} AND m.id_conversation = ${idConversation}
  `);
  const f = filas[0];
  const motivo = motivoRechazoTurno(f, agente.id_agent);
  if (motivo) {
    console.error(`[proyectos-mcp] turno rechazado para ${agente.code} (conv ${idConversation}, msg ${idMessage}): ${motivo}`);
    throw new ProyectosRechazo(RECHAZO_TURNO);
  }
  return {
    agente,
    concesion: {
      id: 0,
      idUser: f!.id_user_author!,
      persona: f!.name?.trim() || String(f!.email ?? ''),
      idAgent: Number(agente.id_agent),
      idProject: null,
      idChat: Number(idConversation),
      venceEn: '',
      idAgenteDesignado: Number(agente.id_agent),
      origen: 'turno',
    },
  };
}

/** Auditoría de una lectura (concesión o turno) en chat_project_event. */
export async function auditarLectura(agente: AgenteFila, c: ConcesionProyectos, idProject: number, que: string): Promise<void> {
  const via = c.origen === 'turno' ? `desde su chat normal (conversación ${c.idChat})` : `a nombre de ${c.persona}`;
  await auditarProyecto({
    idProject,
    entity: 'concesion',
    idEntity: c.origen === 'turno' ? null : c.id,
    action: 'leer',
    detail: `Agente ${agente.code} leyó ${que} ${via}${c.origen === 'turno' ? `, para ${c.persona}` : ''}`,
    idUser: c.idUser,
    idAgent: agente.id_agent,
  });
}

/* ───────────────────────────── Historial de los hilos ───────────────────────────── */

export interface HiloResumen {
  id_hilo: number;
  titulo: string | null;
  asistente: string | null;
  asistente_code: string | null;
  creado: string | null;
  ultimo_mensaje: string | null;
  mensajes: number;
}

export async function hilosDe(idProject: number, db?: Lector): Promise<HiloResumen[]> {
  const filas = await q(db)<{
    id: number;
    title: string | null;
    display_name: string | null;
    code: string | null;
    created_at: Date | null;
    last_message_at: Date | null;
    n: number;
  }>(Prisma.sql`
    SELECT TOP 200 c.id, c.title, a.display_name, a.code, c.created_at, c.last_message_at,
      (SELECT COUNT(1) FROM chat_message m WHERE m.id_conversation = c.id) AS n
    FROM chat_conversation c
    LEFT JOIN agent a ON a.id_agent = c.id_agent
    WHERE c.id_project = ${idProject} AND c.kind = ${'project'} AND c.archived = 0
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
  `);
  return filas.map((f) => ({
    id_hilo: Number(f.id),
    titulo: f.title,
    asistente: f.display_name,
    asistente_code: f.code,
    creado: f.created_at ? new Date(f.created_at).toISOString() : null,
    ultimo_mensaje: f.last_message_at ? new Date(f.last_message_at).toISOString() : null,
    mensajes: Number(f.n ?? 0),
  }));
}

/** Hilo por defecto: el más reciente de ESTE agente; si no tiene, el más reciente del proyecto. */
export function hiloPorDefecto(hilos: HiloResumen[], codeAgente: string): HiloResumen | null {
  const propio = hilos.find((h) => (h.asistente_code ?? '').toLowerCase() === codeAgente.toLowerCase());
  return propio ?? hilos[0] ?? null;
}

export interface MensajeHilo {
  id: number;
  fecha: string;
  rol: 'persona' | 'asistente' | 'sistema';
  autor: string;
  texto: string;
  adjuntos: { nombre: string; tipo: string | null; bytes: number | null }[];
}

export function recortar(texto: string, max = MAX_CHARS_MENSAJE): string {
  return texto.length > max ? `${texto.slice(0, max)}… [recortado]` : texto;
}

export async function mensajesDeHilo(idConversation: number, limite: number, antesDe: number | null, db?: Lector): Promise<MensajeHilo[]> {
  const top = Math.max(1, Math.min(MAX_MENSAJES_HISTORIAL, Math.floor(limite)));
  const filtroAntes = antesDe ? Prisma.sql`AND m.id < ${antesDe}` : Prisma.empty;
  const filas = await q(db)<{
    id: number;
    role: string;
    body: string | null;
    created_at: Date;
    user_name: string | null;
    user_email: string | null;
    agent_name: string | null;
  }>(Prisma.sql`
    SELECT TOP (${top}) m.id, m.role, m.body, m.created_at, u.name AS user_name, u.email AS user_email, a.display_name AS agent_name
    FROM chat_message m
    LEFT JOIN [user] u ON u.id = m.id_user_author
    LEFT JOIN agent a ON a.id_agent = m.id_agent_author
    WHERE m.id_conversation = ${idConversation} ${filtroAntes}
    ORDER BY m.id DESC
  `);
  const ids = filas.map((f) => Number(f.id));
  const adj = ids.length
    ? await q(db)<{ id_message: number; file_name: string; content_type: string | null; size_bytes: number | null }>(Prisma.sql`
        SELECT id_message, file_name, content_type, size_bytes FROM chat_attachment WHERE id_message IN (${Prisma.join(ids)}) ORDER BY id
      `)
    : [];
  const porMensaje = new Map<number, MensajeHilo['adjuntos']>();
  for (const a of adj) {
    const l = porMensaje.get(Number(a.id_message)) ?? [];
    l.push({ nombre: a.file_name, tipo: a.content_type, bytes: a.size_bytes === null ? null : Number(a.size_bytes) });
    porMensaje.set(Number(a.id_message), l);
  }
  return [...filas].reverse().map((f) => {
    const rol = f.role === 'agent' ? 'asistente' : f.role === 'system' ? 'sistema' : 'persona';
    const autor = rol === 'asistente' ? f.agent_name ?? 'Asistente' : rol === 'sistema' ? 'SynerLink' : f.user_name?.trim() || f.user_email || 'Persona';
    return {
      id: Number(f.id),
      fecha: new Date(f.created_at).toISOString(),
      rol,
      autor,
      texto: recortar(String(f.body ?? '')),
      adjuntos: porMensaje.get(Number(f.id)) ?? [],
    };
  });
}

/* ───────────────────────────── PR del proyecto ───────────────────────────── */

export const PREFIJO_RAMA_PROYECTO = 'proyecto/';
const URL_PR_RE = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;

export interface PrMencionado {
  repo: string;
  numero: number;
  url: string;
  id_hilo: number;
  fecha: string;
}

/** PURA: los enlaces a PR de GitHub que aparecen en los mensajes (sin repetir; el más reciente gana). */
export function prsEnTexto(mensajes: { id_conversation: number; body: string | null; created_at: Date | string }[]): PrMencionado[] {
  const out = new Map<string, PrMencionado>();
  for (const m of mensajes) {
    for (const x of String(m.body ?? '').matchAll(URL_PR_RE)) {
      const repo = `${x[1]}/${x[2]}`;
      const numero = Number(x[3]);
      const clave = `${repo.toLowerCase()}#${numero}`;
      const fecha = new Date(m.created_at).toISOString();
      const ya = out.get(clave);
      if (!ya || ya.fecha < fecha) out.set(clave, { repo, numero, url: `https://github.com/${repo}/pull/${numero}`, id_hilo: Number(m.id_conversation), fecha });
    }
  }
  return [...out.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

/** PURA: ¿la rama es de este proyecto? (`proyecto/<id>-…` o `proyecto/<id>`). */
export function ramaDelProyecto(rama: string, idProject: number): boolean {
  const base = `${PREFIJO_RAMA_PROYECTO}${idProject}`;
  return rama === base || rama.startsWith(`${base}-`);
}

/** PURA: «owner/repo» a partir de lo que guarde el catálogo (owner/repo, URL o .git). */
export function repoDeCatalogo(github: string | null | undefined): string | null {
  const s = String(github ?? '').trim().replace(/\.git$/i, '').replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s) ? s : null;
}

export async function reposDelProyecto(idProject: number, db?: Lector): Promise<string[]> {
  try {
    const filas = await q(db)<{ github: string | null }>(Prisma.sql`
      SELECT rc.github FROM chat_project_agent_policy_repo pr INNER JOIN chat_project_repo_catalog rc ON rc.id_repo = pr.id_repo WHERE pr.id_project = ${idProject}
    `);
    return [...new Set(filas.map((f) => repoDeCatalogo(f.github)).filter((r): r is string => Boolean(r)))];
  } catch {
    // La política de repos puede no existir en un entorno viejo: sin repos, solo lo mencionado en los hilos.
    return [];
  }
}

export async function prsMencionadosEnHilos(idProject: number, db?: Lector): Promise<PrMencionado[]> {
  const filas = await q(db)<{ id_conversation: number; body: string | null; created_at: Date }>(Prisma.sql`
    SELECT TOP 2000 m.id_conversation, m.body, m.created_at
    FROM chat_message m
    INNER JOIN chat_conversation c ON c.id = m.id_conversation
    WHERE c.id_project = ${idProject} AND c.kind = ${'project'} AND m.body LIKE ${'%github.com/%/pull/%'}
    ORDER BY m.id DESC
  `);
  return prsEnTexto(filas);
}

export interface PrGithub {
  repo: string;
  numero: number;
  titulo: string;
  estado: 'abierto' | 'fusionado' | 'cerrado';
  rama: string;
  base: string;
  creado: string | null;
  actualizado: string | null;
  fusionado: string | null;
  url: string;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function prDeApi(repo: string, d: Record<string, unknown>): PrGithub {
  const head = (d.head ?? {}) as { ref?: string };
  const base = (d.base ?? {}) as { ref?: string };
  const merged = (d.merged_at as string | null) ?? null;
  return {
    repo,
    numero: Number(d.number),
    titulo: String(d.title ?? ''),
    estado: merged ? 'fusionado' : d.state === 'open' ? 'abierto' : 'cerrado',
    rama: String(head.ref ?? ''),
    base: String(base.ref ?? ''),
    creado: (d.created_at as string | null) ?? null,
    actualizado: (d.updated_at as string | null) ?? null,
    fusionado: merged,
    url: String(d.html_url ?? `https://github.com/${repo}/pull/${d.number}`),
  };
}

/**
 * Consulta GitHub (SOLO LECTURA, token de PROYECTOS_GITHUB_TOKEN): los PR de las
 * ramas `proyecto/<id>-*` en los repos del proyecto + el estado de los PR que se
 * mencionan en los hilos. Sin token, devuelve null (el llamador lo explica).
 */
export async function prsEnGithub(
  idProject: number,
  repos: string[],
  mencionados: PrMencionado[],
  opts: { token?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<{ prs: PrGithub[]; errores: string[] } | null> {
  const token = (opts.token ?? process.env.PROYECTOS_GITHUB_TOKEN ?? '').trim();
  if (!token) return null;
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'kronos-mcp-proyectos' };
  const pedir = async (url: string): Promise<unknown> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
    try {
      const r = await f(url, { headers, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  };
  const prs = new Map<string, PrGithub>();
  const errores: string[] = [];
  for (const repo of repos.slice(0, 10)) {
    try {
      const lista = (await pedir(`https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`)) as Record<string, unknown>[];
      for (const d of Array.isArray(lista) ? lista : []) {
        const pr = prDeApi(repo, d);
        if (ramaDelProyecto(pr.rama, idProject)) prs.set(`${repo.toLowerCase()}#${pr.numero}`, pr);
      }
    } catch (e) {
      errores.push(`${repo}: ${(e as Error).message}`);
    }
  }
  for (const m of mencionados.slice(0, 20)) {
    const clave = `${m.repo.toLowerCase()}#${m.numero}`;
    if (prs.has(clave)) continue;
    try {
      prs.set(clave, prDeApi(m.repo, (await pedir(`https://api.github.com/repos/${m.repo}/pulls/${m.numero}`)) as Record<string, unknown>));
    } catch (e) {
      errores.push(`${m.repo}#${m.numero}: ${(e as Error).message}`);
    }
  }
  return { prs: [...prs.values()].sort((a, b) => ((a.actualizado ?? '') < (b.actualizado ?? '') ? 1 : -1)), errores };
}
