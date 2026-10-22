/**
 * Cronograma de un proyecto — capa de datos (2026-10-18, pedido de Nicolás Rivera).
 *
 * PERMISOS (la reja real; la interfaz solo pinta botones):
 *   - Ver el cronograma: cualquier miembro que pase la puerta del proyecto
 *     (lib/chat/projects.ts → resolveProjectForUser).
 *   - Crear y editar tareas, fijar la fecha objetivo de una solicitud: dueño y
 *     editores (capabilities.contribute), con el proyecto activo.
 *   - Borrar una tarea: el dueño cualquiera; un editor, solo las que creó.
 *   - El responsable de una tarea debe ser MIEMBRO del proyecto.
 *
 * AUDITORÍA: cada creación, cambio y borrado deja una fila INMUTABLE en
 * chat_project_event (quién, cuándo, desde dónde y qué cambió), en la MISMA
 * transacción que el cambio. La tarea guarda además created_by / updated_by.
 *
 * SOLICITUDES: las vinculadas (chat_project_request) con sus fechas reales y
 * su estado vivo, leídos de requests_general / task_request_general en cada
 * carga. Las reglas de qué fecha se usa están en cronograma-rules.ts.
 */
import type { Prisma } from '../../app/generated/prisma';
import { prisma } from '../prisma';
import { sql, withMssqlPool } from '../mssqlPool';
import { rutaSolicitud } from '../correo/acuse';
import { capabilitiesFor, canRemoveContribution, MAX_PROJECT_LINKS } from '../chat/projects-rules';
import type { ProjectAccess, ProjectUser } from '../chat/projects';
import type { CronogramaDto, EventoAuditoriaDto, PersonaDto, SolicitudCronogramaDto, TareaDto } from './tipos';
import {
  cambiosDeTarea,
  describirCambios,
  esFechaIso,
  fechaDeDb,
  hoyBogota,
  MAX_PROJECT_TASKS,
  normalizarTarea,
  type TareaValores,
} from './cronograma-rules';
import { ProyectoError } from './acciones';

type Db = Prisma.TransactionClient | typeof prisma;

export type Via = 'web' | 'puente' | 'mcp';

/** Fila de auditoría (solo INSERT; un trigger impide cambiarla o borrarla). */
export async function registrarEvento(
  db: Db,
  e: {
    idProject: number;
    entity: 'tarea' | 'solicitud' | 'propuesta' | 'concesion';
    idEntity: number | null;
    action: string;
    detail: string;
    changes?: Record<string, unknown> | null;
    idUser: string | null;
    idAgent?: number | null;
    via: Via;
  }
): Promise<void> {
  await db.chatProjectEvent.create({
    data: {
      id_project: e.idProject,
      entity: e.entity,
      id_entity: e.idEntity,
      action: e.action.slice(0, 30),
      detail: e.detail.slice(0, 1000),
      changes: e.changes ? JSON.stringify(e.changes).slice(0, 20_000) : null,
      id_user: e.idUser,
      id_agent: e.idAgent ?? null,
      via: e.via,
    },
  });
}

/* ───────────────────────────── Lecturas auxiliares ───────────────────────────── */

async function miembrosDelProyecto(idProject: number): Promise<{ id: string; name: string; email: string }[]> {
  const filas = await prisma.chatProjectMember.findMany({
    where: { id_project: idProject },
    select: { id_user: true, user: { select: { name: true, email: true } } },
    orderBy: { added_at: 'asc' },
  });
  return filas.map((m) => ({ id: m.id_user, name: m.user.name?.trim() || m.user.email, email: m.user.email.toLowerCase() }));
}

async function nombresDe(ids: Iterable<string | null>): Promise<Map<string, string>> {
  const unicos = [...new Set([...ids].filter((x): x is string => typeof x === 'string' && x.length > 0))];
  const out = new Map<string, string>();
  if (unicos.length === 0) return out;
  const us = await prisma.user.findMany({ where: { id: { in: unicos } }, select: { id: true, name: true, email: true } });
  for (const u of us) out.set(u.id, u.name?.trim() || u.email);
  return out;
}

function valoresDeFila(t: {
  title: string;
  description: string | null;
  id_responsible: string | null;
  start_date: Date;
  end_date: Date;
  status: string;
  progress: number | null;
  is_milestone: boolean;
}): TareaValores {
  return {
    title: t.title,
    description: t.description,
    idResponsible: t.id_responsible,
    startDate: fechaDeDb(t.start_date)!,
    endDate: fechaDeDb(t.end_date)!,
    status: (['pendiente', 'en_curso', 'hecha', 'bloqueada'].includes(t.status) ? t.status : 'pendiente') as TareaValores['status'],
    progress: t.progress,
    isMilestone: t.is_milestone,
  };
}

/** Fecha de calendario para una columna DATE (medianoche UTC). */
function aDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

interface FilaSolicitud {
  id: number;
  created_at: Date | null;
  status_req: number | null;
  date_resolution: Date | null;
  status: string | null;
}

interface FilaActividad {
  id: number;
  id_request_general: number;
  task: string | null;
  id_status: number | null;
  status: string | null;
  assigned: string | null;
  start_date: Date | null;
  end_date: Date | null;
  date_resolution: Date | null;
}

/** Fechas, estado y actividades REALES de las solicitudes (dos consultas, parametrizadas). */
export async function datosVivosDeSolicitudes(ids: number[]): Promise<{ solicitudes: Map<number, FilaSolicitud>; actividades: Map<number, FilaActividad[]> }> {
  const unicos = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_PROJECT_LINKS);
  const solicitudes = new Map<number, FilaSolicitud>();
  const actividades = new Map<number, FilaActividad[]>();
  if (unicos.length === 0) return { solicitudes, actividades };
  await withMssqlPool(async (pool) => {
    const marcas = (req: ReturnType<typeof pool.request>) =>
      unicos.map((id, i) => {
        req.input(`id${i}`, sql.Int, id);
        return `@id${i}`;
      });
    const r1 = pool.request();
    const m1 = marcas(r1);
    const s = await r1.query<FilaSolicitud>(
      `SELECT rg.id, rg.created_at, rg.status_req, rg.date_resolution, sc.status
       FROM requests_general rg LEFT JOIN status_case sc ON sc.id_status_case = rg.status_req
       WHERE rg.id IN (${m1.join(', ')})`
    );
    for (const f of s.recordset) solicitudes.set(f.id, f);
    const r2 = pool.request();
    const m2 = marcas(r2);
    const a = await r2.query<FilaActividad>(
      `SELECT TOP 2000 trg.id, trg.id_request_general, tpc.task, trg.id_status, sc.status, u.name AS assigned,
              trg.start_date, trg.end_date, trg.date_resolution
       FROM task_request_general trg
       LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
       LEFT JOIN status_case sc ON sc.id_status_case = trg.id_status
       LEFT JOIN [user] u ON u.id = trg.id_assigned
       WHERE trg.id_request_general IN (${m2.join(', ')})
       ORDER BY trg.id_request_general, tpc.display_order, trg.id`
    );
    for (const f of a.recordset) {
      const l = actividades.get(f.id_request_general) ?? [];
      l.push(f);
      actividades.set(f.id_request_general, l);
    }
  });
  return { solicitudes, actividades };
}

/* ───────────────────────────── Lectura del cronograma ───────────────────────────── */

const selTarea = {
  id_project_task: true,
  title: true,
  description: true,
  id_responsible: true,
  start_date: true,
  end_date: true,
  status: true,
  progress: true,
  is_milestone: true,
  origin: true,
  created_by: true,
  created_at: true,
  updated_by: true,
  updated_at: true,
} as const;

/** El cronograma tal como lo ve ESTA persona (tareas, solicitudes con fechas, propuestas). */
export async function cronogramaDelProyecto(
  user: ProjectUser,
  project: ProjectAccess,
  opciones: { propuestas?: (u: ProjectUser, p: ProjectAccess) => Promise<CronogramaDto['proposals']> } = {}
): Promise<CronogramaDto> {
  const caps = project.archived ? capabilitiesFor(null) : capabilitiesFor(project.role);
  const [tareas, vinculos, miembros] = await Promise.all([
    prisma.chatProjectTask.findMany({
      where: { id_project: project.idProject },
      select: selTarea,
      orderBy: [{ start_date: 'asc' }, { id_project_task: 'asc' }],
      take: MAX_PROJECT_TASKS,
    }),
    prisma.chatProjectRequest.findMany({
      where: { id_project: project.idProject },
      select: { id_project_request: true, id_request: true, subject: true, process_name: true, linked_by: true, target_date: true },
      orderBy: { linked_at: 'asc' },
      take: MAX_PROJECT_LINKS,
    }),
    miembrosDelProyecto(project.idProject),
  ]);

  const avisos: string[] = [];
  let vivos: Awaited<ReturnType<typeof datosVivosDeSolicitudes>> = { solicitudes: new Map(), actividades: new Map() };
  try {
    vivos = await datosVivosDeSolicitudes(vinculos.map((v) => v.id_request));
  } catch (err) {
    console.error('[proyectos/cronograma] no se pudieron leer las solicitudes:', (err as Error).message);
    if (vinculos.length > 0) avisos.push('No se pudieron leer las fechas y el estado actual de las solicitudes. Se muestran sin fechas.');
  }

  const nombres = new Map(miembros.map((m) => [m.id, m.name]));
  const faltan = new Set<string>();
  for (const t of tareas) for (const x of [t.id_responsible, t.created_by, t.updated_by]) if (x && !nombres.has(x)) faltan.add(x);
  for (const v of vinculos) if (!nombres.has(v.linked_by)) faltan.add(v.linked_by);
  for (const [k, v] of await nombresDe(faltan)) nombres.set(k, v);
  const persona = (id: string | null): PersonaDto | null => (id ? { id, name: nombres.get(id) ?? 'Persona retirada' } : null);

  const tasks: TareaDto[] = tareas.map((t) => {
    const v = valoresDeFila(t);
    return {
      id: t.id_project_task,
      title: v.title,
      description: v.description,
      responsible: persona(v.idResponsible),
      startDate: v.startDate,
      endDate: v.endDate,
      status: v.status,
      progress: v.progress,
      isMilestone: v.isMilestone,
      origin: t.origin === 'agente' ? 'agente' : 'persona',
      createdBy: persona(t.created_by),
      createdAt: t.created_at.toISOString(),
      updatedBy: persona(t.updated_by),
      updatedAt: t.updated_at ? t.updated_at.toISOString() : null,
      puedoEditar: caps.contribute,
      puedoBorrar: !project.archived && canRemoveContribution(project.role, user.id, t.created_by),
    };
  });

  const requests: SolicitudCronogramaDto[] = vinculos.map((v) => {
    const s = vivos.solicitudes.get(v.id_request);
    return {
      idLink: v.id_project_request,
      idRequest: v.id_request,
      subject: v.subject,
      processName: v.process_name,
      estado: s?.status ?? null,
      idStatus: s?.status_req ?? null,
      createdAt: fechaDeDb(s?.created_at),
      resolvedAt: fechaDeDb(s?.date_resolution),
      targetDate: fechaDeDb(v.target_date),
      url: rutaSolicitud(v.id_request),
      linkedBy: persona(v.linked_by),
      actividades: (vivos.actividades.get(v.id_request) ?? []).map((a) => ({
        id: a.id,
        task: a.task?.trim() || 'Actividad',
        idStatus: a.id_status,
        status: a.status,
        assignedTo: a.assigned?.trim() || null,
        startDate: fechaDeDb(a.start_date),
        endDate: fechaDeDb(a.end_date),
        resolvedAt: fechaDeDb(a.date_resolution),
      })),
      puedoFijarFecha: caps.contribute,
      puedoQuitar: !project.archived && canRemoveContribution(project.role, user.id, v.linked_by),
    };
  });

  return {
    hoy: hoyBogota(),
    tasks,
    requests,
    members: miembros.map((m) => ({ id: m.id, name: m.name })),
    capabilities: { crear: caps.contribute, vincular: caps.contribute, fijarFecha: caps.contribute },
    proposals: opciones.propuestas ? await opciones.propuestas(user, project) : [],
    avisos,
  };
}

/* ───────────────────────────── Escrituras ───────────────────────────── */

function exigirEdicion(project: ProjectAccess): void {
  if (project.archived) throw new ProyectoError('El proyecto está archivado. Restáurelo para hacer cambios.', 403);
  if (!capabilitiesFor(project.role).contribute) throw new ProyectoError('Su rol en el proyecto no permite cambiar el cronograma.', 403);
}

async function exigirResponsableMiembro(idProject: number, idResponsible: string | null): Promise<void> {
  if (!idResponsible) return;
  const n = await prisma.chatProjectMember.count({ where: { id_project: idProject, id_user: idResponsible } });
  if (n === 0) throw new ProyectoError('El responsable debe ser miembro del proyecto.', 400);
}

export interface OrigenCambio {
  via: Via;
  idAgent?: number | null;
  /** Texto adicional para la auditoría (p. ej. «propuesta #12 del agente Orus»). */
  nota?: string | null;
}

/** Crea una tarea. Devuelve su id. */
export async function crearTarea(user: ProjectUser, project: ProjectAccess, raw: unknown, origen: OrigenCambio = { via: 'web' }): Promise<{ id: number }> {
  exigirEdicion(project);
  const v = normalizarTarea(raw, null);
  if (!v.ok) throw new ProyectoError(v.error, 400);
  await exigirResponsableMiembro(project.idProject, v.value.idResponsible);
  const n = await prisma.chatProjectTask.count({ where: { id_project: project.idProject } });
  if (n >= MAX_PROJECT_TASKS) throw new ProyectoError(`Un proyecto admite hasta ${MAX_PROJECT_TASKS} tareas.`, 409);

  const t = v.value;
  const id = await prisma.$transaction(async (tx) => {
    const fila = await tx.chatProjectTask.create({
      data: {
        id_project: project.idProject,
        title: t.title,
        description: t.description,
        id_responsible: t.idResponsible,
        start_date: aDate(t.startDate),
        end_date: aDate(t.endDate),
        status: t.status,
        progress: t.progress,
        is_milestone: t.isMilestone,
        origin: origen.via === 'web' ? 'persona' : 'agente',
        created_by: user.id,
      },
      select: { id_project_task: true },
    });
    await registrarEvento(tx, {
      idProject: project.idProject,
      entity: 'tarea',
      idEntity: fila.id_project_task,
      action: 'crear',
      detail: `${t.isMilestone ? 'Hito' : 'Tarea'} «${t.title}» (${t.startDate} → ${t.endDate})${origen.nota ? ` · ${origen.nota}` : ''}`,
      changes: { nueva: t },
      idUser: user.id,
      idAgent: origen.idAgent,
      via: origen.via,
    });
    // La versión del contexto del puente es updated_at: el agente ve el cambio en su próximo turno.
    await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: new Date() } });
    return fila.id_project_task;
  });
  return { id };
}

async function tareaDelProyecto(idProject: number, idTask: unknown) {
  if (typeof idTask !== 'number' || !Number.isInteger(idTask) || idTask <= 0) throw new ProyectoError('Tarea no encontrada.', 404);
  const t = await prisma.chatProjectTask.findFirst({ where: { id_project_task: idTask, id_project: idProject }, select: selTarea });
  if (!t) throw new ProyectoError('Tarea no encontrada.', 404);
  return t;
}

/** Cambia una tarea (solo los campos que vengan). */
export async function editarTarea(
  user: ProjectUser,
  project: ProjectAccess,
  idTask: unknown,
  raw: unknown,
  origen: OrigenCambio = { via: 'web' }
): Promise<{ id: number; cambios: number }> {
  exigirEdicion(project);
  const actual = await tareaDelProyecto(project.idProject, idTask);
  const antes = valoresDeFila(actual);
  const v = normalizarTarea(raw, antes);
  if (!v.ok) throw new ProyectoError(v.error, 400);
  const despues = v.value;
  const cambios = cambiosDeTarea(antes, despues);
  if (Object.keys(cambios).length === 0) return { id: actual.id_project_task, cambios: 0 };
  if (cambios.idResponsible) await exigirResponsableMiembro(project.idProject, despues.idResponsible);

  const nombres = await nombresDe([antes.idResponsible, despues.idResponsible]);
  await prisma.$transaction(async (tx) => {
    await tx.chatProjectTask.update({
      where: { id_project_task: actual.id_project_task },
      data: {
        title: despues.title,
        description: despues.description,
        id_responsible: despues.idResponsible,
        start_date: aDate(despues.startDate),
        end_date: aDate(despues.endDate),
        status: despues.status,
        progress: despues.progress,
        is_milestone: despues.isMilestone,
        updated_by: user.id,
        updated_at: new Date(),
      },
    });
    await registrarEvento(tx, {
      idProject: project.idProject,
      entity: 'tarea',
      idEntity: actual.id_project_task,
      action: Object.keys(cambios).every((c) => c === 'status' || c === 'progress') ? 'estado' : 'editar',
      detail: `«${despues.title}»: ${describirCambios(cambios, (id) => (id ? nombres.get(id) ?? 'Persona retirada' : '—'))}${origen.nota ? ` · ${origen.nota}` : ''}`,
      changes: cambios,
      idUser: user.id,
      idAgent: origen.idAgent,
      via: origen.via,
    });
    await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: new Date() } });
  });
  return { id: actual.id_project_task, cambios: Object.keys(cambios).length };
}

/** Borra una tarea: el dueño cualquiera; un editor, solo las suyas. El historial queda. */
export async function borrarTarea(user: ProjectUser, project: ProjectAccess, idTask: unknown): Promise<void> {
  exigirEdicion(project);
  const actual = await tareaDelProyecto(project.idProject, idTask);
  if (!canRemoveContribution(project.role, user.id, actual.created_by)) {
    throw new ProyectoError('Solo el dueño del proyecto o quien creó la tarea la puede borrar.', 403);
  }
  await prisma.$transaction(async (tx) => {
    await tx.chatProjectTask.delete({ where: { id_project_task: actual.id_project_task } });
    await registrarEvento(tx, {
      idProject: project.idProject,
      entity: 'tarea',
      idEntity: actual.id_project_task,
      action: 'borrar',
      detail: `Borró la tarea «${actual.title}»`,
      changes: { borrada: valoresDeFila(actual) },
      idUser: user.id,
      via: 'web',
    });
    await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: new Date() } });
  });
}

/** Fija (o quita, con null) la fecha objetivo de una solicitud vinculada. */
export async function fijarFechaObjetivo(user: ProjectUser, project: ProjectAccess, idLink: unknown, fecha: unknown): Promise<void> {
  exigirEdicion(project);
  if (typeof idLink !== 'number' || !Number.isInteger(idLink) || idLink <= 0) throw new ProyectoError('Solicitud no encontrada.', 404);
  if (fecha !== null && !esFechaIso(fecha)) throw new ProyectoError('La fecha objetivo debe ir en AAAA-MM-DD.', 400);
  const v = await prisma.chatProjectRequest.findFirst({
    where: { id_project_request: idLink, id_project: project.idProject },
    select: { id_project_request: true, id_request: true, target_date: true },
  });
  if (!v) throw new ProyectoError('Solicitud no encontrada.', 404);
  const antes = fechaDeDb(v.target_date);
  if (antes === fecha) return;
  await prisma.$transaction(async (tx) => {
    await tx.chatProjectRequest.update({ where: { id_project_request: v.id_project_request }, data: { target_date: fecha ? aDate(fecha) : null } });
    await registrarEvento(tx, {
      idProject: project.idProject,
      entity: 'solicitud',
      idEntity: v.id_request,
      action: 'fecha_objetivo',
      detail: `Solicitud #${v.id_request}: fecha objetivo ${antes ?? '—'} → ${fecha ?? '—'}`,
      changes: { targetDate: [antes, fecha] },
      idUser: user.id,
      via: 'web',
    });
    await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: new Date() } });
  });
}

/** Historial de una tarea (o de una solicitud del cronograma), más reciente primero. */
export async function historial(project: ProjectAccess, entity: 'tarea' | 'solicitud', idEntity: number): Promise<EventoAuditoriaDto[]> {
  const filas = await prisma.chatProjectEvent.findMany({
    where: { id_project: project.idProject, entity, id_entity: idEntity },
    orderBy: { id_event: 'desc' },
    take: 50,
    select: { id_event: true, action: true, detail: true, id_user: true, id_agent: true, via: true, created_at: true },
  });
  const nombres = await nombresDe(filas.map((f) => f.id_user));
  const agentes = await prisma.agent.findMany({
    where: { id_agent: { in: [...new Set(filas.map((f) => f.id_agent).filter((x): x is number => x !== null))] } },
    select: { id_agent: true, display_name: true },
  });
  const nombreAgente = new Map(agentes.map((a) => [a.id_agent, a.display_name]));
  return filas.map((f) => ({
    id: f.id_event,
    action: f.action,
    detail: f.detail,
    by: f.id_user ? { id: f.id_user, name: nombres.get(f.id_user) ?? 'Persona retirada' } : null,
    agent: f.id_agent ? nombreAgente.get(f.id_agent) ?? null : null,
    via: f.via,
    at: f.created_at.toISOString(),
  }));
}

function sinTildes(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Resuelve el responsable que propone un agente (correo o nombre EXACTO) a un
 * MIEMBRO del proyecto. Un nombre repetido o desconocido es error: el servidor
 * nunca adivina a quién asignar.
 */
export async function miembroPorReferencia(idProject: number, ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const miembros = await miembrosDelProyecto(idProject);
  const q = sinTildes(ref);
  const porCorreo = miembros.filter((m) => m.email === q);
  const hits = porCorreo.length > 0 ? porCorreo : miembros.filter((m) => sinTildes(m.name) === q);
  if (hits.length !== 1) throw new ProyectoError(`«${ref}» no es un miembro del proyecto (o hay varios con ese nombre): no puede ser responsable.`, 400);
  return hits[0].id;
}

/* ───────────────────────────── Para el agente (puente) ───────────────────────────── */

/**
 * El cronograma para el CONTEXTO del agente: lo mismo que ven los miembros,
 * sin datos de navegación ni permisos.
 */
export async function cronogramaParaAgente(idProject: number) {
  const proyecto = { idProject, name: '', idCompany: 0, profile: '', role: 'reader' as const, archived: false };
  const c = await cronogramaDelProyecto({ id: '', email: '' }, proyecto);
  return {
    hoy: c.hoy,
    tasks: c.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      responsible: t.responsible?.name ?? null,
      startDate: t.startDate,
      endDate: t.endDate,
      status: t.status,
      progress: t.progress,
      isMilestone: t.isMilestone,
      updatedBy: t.updatedBy?.name ?? t.createdBy?.name ?? null,
      updatedAt: t.updatedAt ?? t.createdAt,
    })),
    requests: c.requests.map((r) => ({
      idRequest: r.idRequest,
      subject: r.subject,
      estado: r.estado,
      idStatus: r.idStatus,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      targetDate: r.targetDate,
      actividades: r.actividades.map((a) => ({ task: a.task, status: a.status, startDate: a.startDate, resolvedAt: a.resolvedAt })),
    })),
    members: c.members.map((m) => m.name),
  };
}
