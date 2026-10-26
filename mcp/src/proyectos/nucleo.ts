/**
 * Proyectos de SynerLink desde un agente (2026-10-18, pedido de Nicolás Rivera):
 * núcleo SIN dependencias del SDK de MCP ni de zod. Lo usan las herramientas
 * (src/tools/proyectos.ts) y sus pruebas.
 *
 * IDENTIDAD (mismo patrón que «Consultar a un agente» del Correo, PR #650):
 *   - El agente SIEMPRE actúa a nombre de la PERSONA que le dio la CONCESIÓN
 *     (chat_project_grant), creada desde la sesión de esa persona en SynerLink.
 *     El modelo nunca escoge a nombre de quién actúa: solo pasa el
 *     `concesion_id` opaco (pg_…) que le llegó en el mensaje de contexto.
 *   - La concesión debe ser del agente de la LLAVE, estar vigente (24 h, sin
 *     revocar), la persona activa, con el agente todavía asignado y el chat
 *     directo intacto. Cualquier falla: el MISMO rechazo.
 *   - Cada lectura vuelve a pasar la PUERTA de la persona: miembro del
 *     proyecto, con el permiso del módulo en la empresa del proyecto y el
 *     proyecto activo. Las lecturas son lo que ella ve; nunca un permiso global.
 *   - Las escrituras SOLO PROPONEN (chat_project_proposal 'pendiente'). Solo
 *     esa persona las confirma con un clic en SynerLink, y SynerLink vuelve a
 *     validar todo con su sesión (lib/proyectos/propuestas.ts del front).
 *   - Auditoría: chat_project_event (lecturas por proyecto, propuestas,
 *     rechazos) + el log de llamadas del MCP.
 *
 * SQL siempre parametrizado (Prisma.sql). Lecturas por queryReadOnly; escrituras
 * por executeWrite, SOLO sobre chat_project_proposal, chat_message,
 * chat_conversation (last_message_at) y chat_project_event.
 */
import { Prisma, queryReadOnly } from '../db.js';
import { executeWrite, type TxClient } from '../write.js';
import type { AuthScope } from '../auth.js';

export const RECHAZO_CONCESION_PROYECTOS =
  'La concesión no existe, venció, fue revocada o no corresponde a este agente. Pídale a la persona que le vuelva a dar acceso desde Proyectos en SynerLink («Gestionar con un asistente»).';
export const RECHAZO_PROYECTO = 'Proyecto no encontrado entre los que la persona puede ver con esta concesión.';

/** Propuestas pendientes por proyecto (igual que el front: MAX_PENDING_PROPOSALS). */
export const MAX_PENDIENTES_PROYECTO = 30;
/** Rango máximo del calendario. */
export const MAX_DIAS_CALENDARIO = 92;
/** Tareas por proyecto (igual que el front: MAX_PROJECT_TASKS). */
export const MAX_TAREAS = 300;
export const MAX_SOLICITUDES = 100;

export class ProyectosRechazo extends Error {}

const TOKEN_RE = /^pg_[A-Za-z0-9_-]{16,60}$/;
const URL_MODULO = '/process/proyectos';

export type Lector = Pick<TxClient, '$queryRaw'>;

export interface AgenteFila {
  id_agent: number;
  code: string;
  display_name: string;
  id_subprocess: number | null;
}

export interface ConcesionProyectos {
  id: number;
  idUser: string;
  persona: string;
  idAgent: number;
  /** null = todos los proyectos de la persona. */
  idProject: number | null;
  idChat: number;
  venceEn: string;
}

export type Rol = 'owner' | 'editor' | 'reader';

export interface ProyectoVisible {
  idProject: number;
  name: string;
  description: string | null;
  idCompany: number;
  company: string;
  role: Rol;
}

export function rolDeDb(raw: string | null | undefined): Rol {
  if (raw === 'owner') return 'owner';
  if (raw === 'editor' || raw === 'member') return 'editor';
  return 'reader';
}

export function codigoAgente(scope: AuthScope): string {
  return String(scope.agentCode ?? scope.agent ?? '').trim().toLowerCase();
}

function q(db?: Lector) {
  return <T>(sql: Prisma.Sql) => (db ? (db.$queryRaw<T[]>(sql) as Promise<T[]>) : queryReadOnly<T>(sql));
}

/** Auditoría en chat_project_event (no tumba la respuesta si falla). */
export async function auditarProyecto(e: {
  idProject: number;
  entity: 'propuesta' | 'concesion';
  idEntity: number | null;
  action: string;
  detail: string;
  idUser: string | null;
  idAgent: number | null;
}): Promise<void> {
  try {
    await executeWrite((tx) => insertarEvento(tx, e));
  } catch (err) {
    console.error('[proyectos-mcp] no se pudo auditar:', (err as Error).message);
  }
}

async function insertarEvento(
  tx: Pick<TxClient, '$executeRaw'>,
  e: { idProject: number; entity: string; idEntity: number | null; action: string; detail: string; idUser: string | null; idAgent: number | null }
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO chat_project_event (id_project, entity, id_entity, action, detail, id_user, id_agent, via, created_at)
    VALUES (${e.idProject}, ${e.entity}, ${e.idEntity}, ${e.action.slice(0, 30)}, ${e.detail.slice(0, 1000)}, ${e.idUser}, ${e.idAgent}, ${'mcp'}, SYSUTCDATETIME())
  `);
}

/**
 * Resuelve y VALIDA la concesión para el agente de la llave. Cualquier falla →
 * el mismo rechazo (no se confirma si la concesión existe).
 */
export async function resolverConcesionProyectos(scope: AuthScope, concesionId: string, db?: Lector): Promise<{ agente: AgenteFila; concesion: ConcesionProyectos }> {
  const leer = q(db);
  const code = codigoAgente(scope);
  if (!code) throw new ProyectosRechazo('Esta llave no identifica a un agente de SynerLink.');
  const agentes = await leer<AgenteFila>(Prisma.sql`
    SELECT TOP 1 a.id_agent, a.code, a.display_name, a.id_subprocess FROM agent a WHERE LOWER(a.code) = ${code} AND a.is_active = 1
  `);
  const agente = agentes[0];
  if (!agente) throw new ProyectosRechazo('Esta llave no identifica a un agente activo de SynerLink.');
  const token = String(concesionId ?? '').trim();
  if (!TOKEN_RE.test(token)) throw new ProyectosRechazo(RECHAZO_CONCESION_PROYECTOS);

  const filas = await leer<{
    id_grant: number;
    id_user: string;
    id_agent: number;
    id_project: number | null;
    id_chat_conversation: number;
    expires_at: Date;
    vigente: number | boolean;
    name: string | null;
    email: string | null;
    isActive: number | boolean | null;
    role: string | null;
  }>(Prisma.sql`
    SELECT TOP 1 g.id_grant, g.id_user, g.id_agent, g.id_project, g.id_chat_conversation, g.expires_at,
      CASE WHEN g.revoked_at IS NULL AND g.expires_at > SYSUTCDATETIME() THEN 1 ELSE 0 END AS vigente,
      u.name, u.email, u.isActive, u.role
    FROM chat_project_grant g
    INNER JOIN [user] u ON u.id = g.id_user
    WHERE g.token = ${token}
  `);
  const g = filas[0];
  if (!g) throw new ProyectosRechazo(RECHAZO_CONCESION_PROYECTOS);
  const negar = async (motivo: string): Promise<never> => {
    if (g.id_project) {
      await auditarProyecto({
        idProject: Number(g.id_project),
        entity: 'concesion',
        idEntity: Number(g.id_grant),
        action: 'denegar',
        detail: `Agente ${agente.code} intentó usar la concesión #${g.id_grant}: ${motivo}`,
        idUser: g.id_user,
        idAgent: agente.id_agent,
      });
    }
    throw new ProyectosRechazo(RECHAZO_CONCESION_PROYECTOS);
  };
  if (Number(g.id_agent) !== Number(agente.id_agent)) return negar('la concesión es de otro agente');
  if (!(g.vigente === 1 || g.vigente === true)) return negar('concesión vencida o revocada');
  if (g.isActive === false || g.isActive === 0 || g.role === 'supplier') return negar('la persona está inactiva');
  if (agente.id_subprocess == null) return negar('el agente no tiene permiso asignable');
  const permiso = await leer<{ n: number }>(Prisma.sql`
    SELECT COUNT(1) AS n
    FROM subprocess_user_company suc
    INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
    INNER JOIN agent_company ac ON ac.id_company = cu.id_company AND ac.id_agent = ${agente.id_agent}
    WHERE cu.id_user = ${g.id_user} AND suc.id_subprocess = ${agente.id_subprocess}
  `);
  if (!(Number(permiso[0]?.n) > 0)) return negar('la persona ya no tiene asignado este agente');
  const chat = await leer<{ id: number }>(Prisma.sql`
    SELECT TOP 1 c.id FROM chat_conversation c
    WHERE c.id = ${g.id_chat_conversation} AND c.kind = ${'direct'} AND c.id_agent = ${agente.id_agent} AND c.id_user = ${g.id_user}
  `);
  if (!chat[0]) return negar('el chat de la concesión ya no existe');
  return {
    agente,
    concesion: {
      id: Number(g.id_grant),
      idUser: g.id_user,
      persona: g.name?.trim() || String(g.email ?? ''),
      idAgent: Number(g.id_agent),
      idProject: g.id_project === null ? null : Number(g.id_project),
      idChat: Number(g.id_chat_conversation),
      venceEn: new Date(g.expires_at).toISOString(),
    },
  };
}

/**
 * PUERTA de la persona: proyectos ACTIVOS donde es miembro, con el permiso del
 * módulo «Proyectos» en la empresa del proyecto, dentro del alcance de la
 * concesión. Con `idProject`, solo ese (o vacío).
 */
export async function proyectosVisibles(c: ConcesionProyectos, idProject?: number | null, db?: Lector): Promise<ProyectoVisible[]> {
  const leer = q(db);
  const filtroConcesion = c.idProject ? Prisma.sql`AND p.id_project = ${c.idProject}` : Prisma.empty;
  const filtroPedido = idProject ? Prisma.sql`AND p.id_project = ${idProject}` : Prisma.empty;
  const filas = await leer<{ id_project: number; name: string; description: string | null; id_company: number; company: string | null; role: string | null }>(Prisma.sql`
    SELECT TOP 200 p.id_project, p.name, p.description, p.id_company, c.company, m.role
    FROM chat_project p
    INNER JOIN chat_project_member m ON m.id_project = p.id_project AND m.id_user = ${c.idUser}
    LEFT JOIN company c ON c.id_company = p.id_company
    WHERE p.archived = 0 ${filtroConcesion} ${filtroPedido}
      AND EXISTS (
        SELECT 1 FROM subprocess_user_company suc
        INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
        INNER JOIN subprocess s ON s.id_subprocess = suc.id_subprocess
        WHERE cu.id_user = ${c.idUser} AND cu.id_company = p.id_company AND s.subprocess_url = ${URL_MODULO}
      )
    ORDER BY p.updated_at DESC
  `);
  return filas.map((f) => ({
    idProject: Number(f.id_project),
    name: f.name,
    description: f.description,
    idCompany: Number(f.id_company),
    company: String(f.company ?? '').trim(),
    role: rolDeDb(f.role),
  }));
}

/** Un proyecto que la persona ve, o el rechazo. */
export async function proyectoVisible(c: ConcesionProyectos, idProject: number, db?: Lector): Promise<ProyectoVisible> {
  if (!Number.isInteger(idProject) || idProject <= 0) throw new ProyectosRechazo(RECHAZO_PROYECTO);
  const p = (await proyectosVisibles(c, idProject, db))[0];
  if (!p) throw new ProyectosRechazo(RECHAZO_PROYECTO);
  return p;
}

/* ───────────────────────────── Fechas (mismo criterio del front) ───────────────────────────── */
/*
 * Réplica de lib/proyectos/cronograma-rules.ts (fechasDeSolicitud, eventosCalendario):
 * el MCP compila solo src/. La prueba test/proyectos.test.ts compara ambas.
 */

export function fechaDeDb(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function hoyBogota(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export function fechasDeSolicitud(e: { createdAt: string | null; resolvedAt: string | null; idStatus: number | null; targetDate: string | null }, hoy: string) {
  const inicio = e.createdAt ?? e.targetDate ?? hoy;
  if (e.idStatus === 2 || e.idStatus === 3) {
    const fin = e.resolvedAt && e.resolvedAt >= inicio ? e.resolvedAt : inicio;
    return { inicio, fin, abierta: false, vencida: false, estadoVisual: e.idStatus === 3 ? 'cancelada' : 'hecha' };
  }
  const fin = e.targetDate && e.targetDate > hoy ? e.targetDate : hoy;
  const vencida = Boolean(e.targetDate && e.targetDate < hoy);
  return { inicio, fin: fin < inicio ? inicio : fin, abierta: true, vencida, estadoVisual: vencida ? 'vencida' : 'abierta' };
}

export function estadoVisualTarea(t: { status: string; endDate: string }, hoy: string): string {
  if ((t.status === 'pendiente' || t.status === 'en_curso') && t.endDate < hoy) return 'vencida';
  return t.status;
}

export interface EventoCal {
  key: string;
  fecha: string;
  tipo: 'inicio' | 'fin' | 'hito' | 'creada' | 'objetivo' | 'resuelta';
  titulo: string;
  estado: string;
  ref: { kind: 'tarea' | 'solicitud'; id: number };
}

export function eventosCalendario(
  tareas: { id: number; title: string; startDate: string; endDate: string; status: string; isMilestone: boolean }[],
  solicitudes: { idRequest: number; subject: string; createdAt: string | null; resolvedAt: string | null; idStatus: number | null; targetDate: string | null }[],
  hoy: string
): EventoCal[] {
  const out: EventoCal[] = [];
  for (const t of tareas) {
    const estado = estadoVisualTarea(t, hoy);
    const ref = { kind: 'tarea' as const, id: t.id };
    if (t.isMilestone) out.push({ key: `t${t.id}-h`, fecha: t.startDate, tipo: 'hito', titulo: t.title, estado, ref });
    else if (t.startDate === t.endDate) out.push({ key: `t${t.id}-f`, fecha: t.endDate, tipo: 'fin', titulo: t.title, estado, ref });
    else {
      out.push({ key: `t${t.id}-i`, fecha: t.startDate, tipo: 'inicio', titulo: t.title, estado, ref });
      out.push({ key: `t${t.id}-f`, fecha: t.endDate, tipo: 'fin', titulo: t.title, estado, ref });
    }
  }
  for (const s of solicitudes) {
    const f = fechasDeSolicitud(s, hoy);
    const ref = { kind: 'solicitud' as const, id: s.idRequest };
    const titulo = `#${s.idRequest} ${s.subject}`;
    if (s.createdAt) out.push({ key: `s${s.idRequest}-c`, fecha: s.createdAt, tipo: 'creada', titulo, estado: f.estadoVisual, ref });
    if (s.targetDate) out.push({ key: `s${s.idRequest}-o`, fecha: s.targetDate, tipo: 'objetivo', titulo, estado: f.estadoVisual, ref });
    if (!f.abierta && s.resolvedAt) out.push({ key: `s${s.idRequest}-r`, fecha: s.resolvedAt, tipo: 'resuelta', titulo, estado: f.estadoVisual, ref });
  }
  return out.sort((a, b) => (a.fecha === b.fecha ? a.titulo.localeCompare(b.titulo, 'es') : a.fecha < b.fecha ? -1 : 1));
}

/* ───────────────────────────── Lecturas del proyecto ───────────────────────────── */

export interface TareaMcp {
  id: number;
  title: string;
  description: string | null;
  responsable: string | null;
  startDate: string;
  endDate: string;
  status: string;
  progress: number | null;
  isMilestone: boolean;
  vencida: boolean;
  updatedAt: string | null;
}

export async function tareasDe(idProject: number, hoy: string): Promise<TareaMcp[]> {
  const filas = await queryReadOnly<{
    id_project_task: number;
    title: string;
    description: string | null;
    responsable: string | null;
    start_date: Date;
    end_date: Date;
    status: string;
    progress: number | null;
    is_milestone: boolean | number;
    updated_at: Date | null;
    created_at: Date;
  }>(Prisma.sql`
    SELECT TOP 300 t.id_project_task, t.title, t.description, u.name AS responsable, t.start_date, t.end_date, t.status, t.progress, t.is_milestone, t.updated_at, t.created_at
    FROM chat_project_task t
    LEFT JOIN [user] u ON u.id = t.id_responsible
    WHERE t.id_project = ${idProject}
    ORDER BY t.start_date, t.id_project_task
  `);
  return filas.map((t) => {
    const startDate = fechaDeDb(t.start_date)!;
    const endDate = fechaDeDb(t.end_date)!;
    return {
      id: Number(t.id_project_task),
      title: t.title,
      description: t.description,
      responsable: t.responsable?.trim() || null,
      startDate,
      endDate,
      status: t.status,
      progress: t.progress === null ? null : Number(t.progress),
      isMilestone: t.is_milestone === true || t.is_milestone === 1,
      vencida: estadoVisualTarea({ status: t.status, endDate }, hoy) === 'vencida',
      updatedAt: (t.updated_at ?? t.created_at)?.toISOString?.() ?? null,
    };
  });
}

export interface SolicitudMcp {
  idRequest: number;
  subject: string;
  processName: string | null;
  estado: string | null;
  idStatus: number | null;
  createdAt: string | null;
  resolvedAt: string | null;
  targetDate: string | null;
  vencida: boolean;
  actividades: { task: string; status: string | null; assignedTo: string | null; startDate: string | null; resolvedAt: string | null }[];
}

/** Solicitudes VINCULADAS al proyecto con sus fechas reales y estado vivo (lo que ven todos los miembros). */
export async function solicitudesDe(idProject: number, hoy: string): Promise<SolicitudMcp[]> {
  const filas = await queryReadOnly<{
    id_request: number;
    subject: string;
    process_name: string | null;
    target_date: Date | null;
    created_at: Date | null;
    status_req: number | null;
    date_resolution: Date | null;
    status: string | null;
  }>(Prisma.sql`
    SELECT TOP 100 pr.id_request, pr.subject, pr.process_name, pr.target_date, rg.created_at, rg.status_req, rg.date_resolution, sc.status
    FROM chat_project_request pr
    LEFT JOIN requests_general rg ON rg.id = pr.id_request
    LEFT JOIN status_case sc ON sc.id_status_case = rg.status_req
    WHERE pr.id_project = ${idProject}
    ORDER BY pr.linked_at
  `);
  if (filas.length === 0) return [];
  const acts = await queryReadOnly<{
    id_request_general: number;
    task: string | null;
    status: string | null;
    assigned: string | null;
    start_date: Date | null;
    date_resolution: Date | null;
    end_date: Date | null;
  }>(Prisma.sql`
    SELECT TOP 2000 trg.id_request_general, tpc.task, sc.status, u.name AS assigned, trg.start_date, trg.date_resolution, trg.end_date
    FROM task_request_general trg
    INNER JOIN chat_project_request pr ON pr.id_request = trg.id_request_general AND pr.id_project = ${idProject}
    LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
    LEFT JOIN status_case sc ON sc.id_status_case = trg.id_status
    LEFT JOIN [user] u ON u.id = trg.id_assigned
    ORDER BY trg.id_request_general, tpc.display_order, trg.id
  `);
  const porSolicitud = new Map<number, SolicitudMcp['actividades']>();
  for (const a of acts) {
    const l = porSolicitud.get(Number(a.id_request_general)) ?? [];
    l.push({ task: a.task?.trim() || 'Actividad', status: a.status, assignedTo: a.assigned?.trim() || null, startDate: fechaDeDb(a.start_date), resolvedAt: fechaDeDb(a.date_resolution ?? a.end_date) });
    porSolicitud.set(Number(a.id_request_general), l);
  }
  return filas.map((f) => {
    const s = {
      createdAt: fechaDeDb(f.created_at),
      resolvedAt: fechaDeDb(f.date_resolution),
      idStatus: f.status_req === null ? null : Number(f.status_req),
      targetDate: fechaDeDb(f.target_date),
    };
    return {
      idRequest: Number(f.id_request),
      subject: f.subject,
      processName: f.process_name,
      estado: f.status,
      ...s,
      vencida: fechasDeSolicitud(s, hoy).vencida,
      actividades: porSolicitud.get(Number(f.id_request)) ?? [],
    };
  });
}

/* ───────────────────────────── Propuestas ───────────────────────────── */

export type TipoPropuesta = 'tarea_crear' | 'tarea_editar' | 'solicitud_vincular' | 'solicitud_desvincular' | 'conversacion_crear' | 'miembro_invitar';

/** Rol que exige cada propuesta (el mismo que exige el front al confirmar). */
export function rolPermite(rol: Rol, tipo: TipoPropuesta): boolean {
  if (tipo === 'miembro_invitar') return rol === 'owner';
  return rol === 'owner' || rol === 'editor';
}

/**
 * Registra una PROPUESTA (nunca la ejecuta) en UNA transacción: revalida la
 * concesión y la puerta del proyecto DENTRO, exige el rol, respeta el cupo de
 * pendientes, inserta la propuesta (vence con la concesión), el aviso en el
 * chat de la concesión y la auditoría.
 */
export async function proponerEnProyecto(
  scope: AuthScope,
  concesionId: string,
  idProject: number,
  tipo: TipoPropuesta,
  armar: (p: ProyectoVisible, c: ConcesionProyectos, tx: TxClient) => Promise<{ payload: Record<string, unknown>; resumen: string }>
): Promise<{ propuesta_id: number; proyecto: ProyectoVisible; resumen: string; vence: string }> {
  return executeWrite(async (tx) => {
    const { agente, concesion } = await resolverConcesionProyectos(scope, concesionId, tx);
    const proyecto = await proyectoVisible(concesion, idProject, tx);
    if (!rolPermite(proyecto.role, tipo)) {
      await insertarEvento(tx, {
        idProject: proyecto.idProject,
        entity: 'propuesta',
        idEntity: null,
        action: 'denegar',
        detail: `Agente ${agente.code} intentó proponer ${tipo} a nombre de ${concesion.persona}, que es ${proyecto.role === 'reader' ? 'lector' : 'editor'}`,
        idUser: concesion.idUser,
        idAgent: agente.id_agent,
      });
      throw new ProyectosRechazo(
        tipo === 'miembro_invitar'
          ? 'Solo el dueño del proyecto puede invitar: la persona no es la dueña.'
          : 'La persona es LECTORA en este proyecto: no se pueden proponer cambios a su nombre.'
      );
    }
    const pend = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(1) AS n FROM chat_project_proposal WHERE id_project = ${proyecto.idProject} AND status = ${'pendiente'} AND expires_at > SYSUTCDATETIME()
    `);
    if (Number(pend[0]?.n) >= MAX_PENDIENTES_PROYECTO) {
      throw new ProyectosRechazo(`El proyecto ya tiene ${MAX_PENDIENTES_PROYECTO} propuestas pendientes: espere a que se decidan.`);
    }
    const a = await armar(proyecto, concesion, tx);
    const resumen = a.resumen.slice(0, 500);
    const ahora = new Date();
    const vence = new Date(concesion.venceEn);
    const fila = await tx.$queryRaw<{ id_proposal: number }[]>(Prisma.sql`
      INSERT INTO chat_project_proposal (id_project, kind, payload, summary, status, source, id_agent, id_conversation, id_grant, requested_for, created_at, expires_at)
      OUTPUT INSERTED.id_proposal
      VALUES (${proyecto.idProject}, ${tipo}, ${JSON.stringify({ kind: tipo, ...a.payload })}, ${resumen}, ${'pendiente'}, ${'mcp'}, ${agente.id_agent}, ${concesion.idChat}, ${concesion.id}, ${concesion.idUser}, ${ahora}, ${vence})
    `);
    const idP = Number(fila[0]?.id_proposal);
    const cuerpo =
      `📌 **Propuesta #${idP}** para el proyecto **«${proyecto.name.replace(/[*_`]/g, '')}»**: ${resumen}.\n\n` +
      `Confírmela o recházela en [Proyectos → Cronograma](/process/proyectos/${proyecto.idProject}?seccion=cronograma). Nada cambia sin su clic.`;
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO chat_message (id_conversation, role, body, created_at, id_agent_author, delivered_at)
      VALUES (${concesion.idChat}, ${'agent'}, ${cuerpo}, ${ahora}, ${agente.id_agent}, ${ahora})
    `);
    await tx.$executeRaw(Prisma.sql`UPDATE chat_conversation SET last_message_at = ${ahora} WHERE id = ${concesion.idChat}`);
    await insertarEvento(tx, {
      idProject: proyecto.idProject,
      entity: 'propuesta',
      idEntity: idP,
      action: 'proponer',
      detail: `Agente ${agente.code}, a nombre de ${concesion.persona} (concesión #${concesion.id}): ${resumen}. Pendiente de confirmación.`,
      idUser: concesion.idUser,
      idAgent: agente.id_agent,
    });
    return { propuesta_id: idP, proyecto, resumen, vence: vence.toISOString() };
  });
}

/** ¿La persona PARTICIPA en la solicitud (misma regla de visibilidad del Correo y del front)? */
export async function solicitudVisiblePara(tx: Lector, idUser: string, idRequest: number, idCompany: number): Promise<{ subject: string } | null> {
  const r = await tx.$queryRaw<{ subject_request: string }[]>(Prisma.sql`
    SELECT TOP 1 rg.subject_request FROM requests_general rg
    WHERE rg.id = ${idRequest} AND rg.id_company = ${idCompany} AND (
      rg.id_requester = ${idUser}
      OR EXISTS (SELECT 1 FROM task_request_general t WHERE t.id_request_general = rg.id AND t.id_assigned = ${idUser})
      OR EXISTS (
        SELECT 1 FROM process_category_request_general pcr
        INNER JOIN user_process_category_request_general up ON up.id_process_category = pcr.id_process_category
        WHERE pcr.id_request_general = rg.id AND up.id_user = ${idUser}
      )
    )
  `);
  return r[0] ? { subject: r[0].subject_request } : null;
}
