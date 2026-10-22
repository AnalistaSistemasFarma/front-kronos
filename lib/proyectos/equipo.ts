/**
 * EQUIPO DE SUBAGENTES de un proyecto — capa de datos (F2, 2026-10-18).
 * Reglas puras en ./equipo-rules.ts; el lado del puente, en
 * puente-hilos/src/equipo.mjs.
 *
 * PERMISOS (la reja real; la interfaz solo pinta botones):
 *   - Ver el equipo, su actividad y su consumo: cualquier miembro.
 *   - Pedir una sugerencia: dueño y editor, y solo con un agente del proyecto
 *     al que la persona le puede escribir (consume del plan de ese agente).
 *   - Aprobar, editar, descartar, restaurar: el dueño (el editor, solo si
 *     PROYECTOS_EQUIPO_EDITOR_APRUEBA=1).
 *   - Encender/apagar el equipo y el tope de simultáneos: el dueño.
 *   - Con el proyecto archivado, nada se cambia.
 *
 * AUDITORÍA: todo cambio deja una fila INMUTABLE en chat_project_team_event
 * (un trigger impide cambiarla o borrarla), en la MISMA transacción.
 *
 * El puente (llave de scope "projects") solo ve pedidos y equipos de
 * proyectos ACTIVOS donde su agente está designado, y solo recibe lo APROBADO.
 */
import { Prisma } from '../../app/generated/prisma';
import { prisma } from '../prisma';
import { profileLabel } from '../chat/projects-rules';
import { cargarConfigProyectos } from './config-agentes';
import { writeAccessForAgent, type ProjectAccess, type ProjectUser } from '../chat/projects';
import { vinculosDelProyecto } from '../chat/projects-links';
import { cronogramaParaAgente } from './cronograma';
import { ProyectoError } from './acciones';
import { aNumero } from '../chat/turn-usage-sums';
import type { AgenteMiniDto, CorridaSubagenteDto, EquipoDto, PedidoEquipoDto, PersonaDto, SubagenteDto } from './tipos';
import {
  capacidadesEquipo,
  diferencias,
  editorApruebaEquipo,
  esEstadoSubagente,
  herramientasADb,
  herramientasDeDb,
  herramientasDisponibles,
  MAX_CORRIDAS_POR_TURNO,
  MAX_EQUIPO,
  MAX_PEDIDOS_DIA,
  MAX_SUBAGENTES_VIVOS,
  MAX_SUGERIDOS,
  modeloDeDb,
  normalizarConfig,
  normalizarCorrida,
  normalizarMiembro,
  PEDIDO_EN_CURSO_VENCE_MS,
  PEDIDO_PENDIENTE_VENCE_MS,
  PROFUNDIDAD_SUBAGENTES,
  slugDe,
  TOPE_SIMULTANEOS_MAX,
  type MiembroValores,
} from './equipo-rules';

type Db = Prisma.TransactionClient | typeof prisma;

const agenteMini = { id_agent: true, code: true, display_name: true, handle: true, avatar_url: true, avatar_updated_at: true } as const;
type FilaAgente = { id_agent: number; code: string; display_name: string; handle: string | null; avatar_url: string | null; avatar_updated_at: Date | null };
function aAgenteMini(a: FilaAgente): AgenteMiniDto {
  return { idAgent: a.id_agent, code: a.code, displayName: a.display_name, handle: a.handle, avatarUrl: a.avatar_url, avatarVersion: a.avatar_updated_at ? a.avatar_updated_at.getTime() : null };
}

/** Fila de auditoría del equipo (solo INSERT). */
export async function registrarEventoEquipo(
  db: Db,
  e: {
    idProject: number;
    idSubagent?: number | null;
    action: string;
    detail: string;
    changes?: Record<string, unknown> | null;
    idUser?: string | null;
    idAgent?: number | null;
    via: 'web' | 'puente';
  }
): Promise<void> {
  await db.chatProjectTeamEvent.create({
    data: {
      id_project: e.idProject,
      id_subagent: e.idSubagent ?? null,
      action: e.action.slice(0, 30),
      detail: e.detail.slice(0, 1000),
      changes: e.changes ? JSON.stringify(e.changes).slice(0, 20_000) : null,
      id_user: e.idUser ?? null,
      id_agent: e.idAgent ?? null,
      via: e.via,
    },
  });
}

/** Vence los pedidos que nadie atendió a tiempo (perezoso: se llama al leer). */
export async function vencerPedidos(where: Prisma.ChatProjectTeamRequestWhereInput = {}): Promise<void> {
  const ahora = Date.now();
  await prisma.chatProjectTeamRequest.updateMany({
    where: { ...where, status: 'pendiente', requested_at: { lt: new Date(ahora - PEDIDO_PENDIENTE_VENCE_MS) } },
    data: { status: 'vencida', finished_at: new Date(ahora), error: 'Nadie atendió el pedido a tiempo (¿el puente del asistente está apagado?).' },
  });
  await prisma.chatProjectTeamRequest.updateMany({
    where: { ...where, status: 'en_curso', claimed_at: { lt: new Date(ahora - PEDIDO_EN_CURSO_VENCE_MS) } },
    data: { status: 'vencida', finished_at: new Date(ahora), error: 'El asistente no respondió a tiempo.' },
  });
}

function aValores(f: { name: string; purpose: string; instructions: string | null; tools: string; model: string | null }): MiembroValores {
  return { name: f.name, purpose: f.purpose, instructions: f.instructions, tools: herramientasDeDb(f.tools), model: modeloDeDb(f.model) };
}

/* ─────────────────────────────── Lectura ─────────────────────────────── */

export async function equipoDelProyecto(user: ProjectUser, project: ProjectAccess): Promise<EquipoDto> {
  await vencerPedidos({ id_project: project.idProject });
  const caps = capacidadesEquipo(project.role, project.archived, editorApruebaEquipo());
  const desde = new Date(Date.now() - 30 * 24 * 60 * 60_000);

  const [p, filas, pedido, corridas, usoPorSub] = await Promise.all([
    prisma.chatProject.findUnique({
      where: { id_project: project.idProject },
      select: {
        team_enabled: true,
        team_max_parallel: true,
        agents: { select: { agent: { select: { ...agenteMini, is_active: true } } }, orderBy: { added_at: 'asc' } },
      },
    }),
    prisma.chatProjectSubagent.findMany({
      where: { id_project: project.idProject },
      orderBy: [{ created_at: 'asc' }, { id_subagent: 'asc' }],
      take: 60,
    }),
    prisma.chatProjectTeamRequest.findFirst({
      where: { id_project: project.idProject },
      orderBy: { requested_at: 'desc' },
    }),
    prisma.chatProjectSubagentRun.findMany({
      where: { id_project: project.idProject },
      orderBy: [{ created_at: 'desc' }, { id_run: 'desc' }],
      take: 25,
    }),
    // SUM con BIGINT: `total_tokens` es INT y SQL Server suma un INT como INT;
    // el groupBy de Prisma desborda (P2020) en cuanto el total pasa de 2.147
    // millones, como pasó con chat_agent_turn_usage (2026-10-21).
    prisma.$queryRaw<Array<{ slug: string; corridas: unknown; tokens: unknown; ultima: Date | null }>>(Prisma.sql`
      SELECT slug, COUNT_BIG(*) AS corridas, SUM(CAST(total_tokens AS BIGINT)) AS tokens, MAX(created_at) AS ultima
      FROM [chat_project_subagent_run]
      WHERE id_project = ${project.idProject} AND created_at >= ${desde}
      GROUP BY slug
    `).then((filas) => filas.map((r) => ({ slug: r.slug, corridas: aNumero(r.corridas), tokens: aNumero(r.tokens), ultima: r.ultima }))),
  ]);
  if (!p) throw new ProyectoError('Proyecto no encontrado.', 404);

  // Nombres de personas (revisores, quien pidió) y títulos de conversaciones, en dos consultas.
  const ids = new Set<string>();
  for (const f of filas) if (f.reviewed_by) ids.add(f.reviewed_by);
  if (pedido?.requested_by) ids.add(pedido.requested_by);
  const personas = ids.size
    ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, email: true } })
    : [];
  const nombre = new Map(personas.map((u) => [u.id, u.name?.trim() || u.email]));
  const persona = (id: string | null): PersonaDto | null => (id ? { id, name: nombre.get(id) ?? 'Persona retirada' } : null);
  const convIds = [...new Set(corridas.map((c) => c.id_conversation))];
  const convs = convIds.length
    ? await prisma.chatConversation.findMany({ where: { id: { in: convIds }, id_project: project.idProject }, select: { id: true, title: true } })
    : [];
  const titulo = new Map(convs.map((c) => [c.id, c.title]));

  const agentes = new Map(p.agents.map((x) => [x.agent.id_agent, x.agent]));
  const uso = new Map(usoPorSub.map((u) => [u.slug, u]));
  const nombreDeSlug = new Map(filas.map((f) => [f.slug, f.name]));

  // Agentes con los que ESTA persona puede pedir una sugerencia.
  const sugeridores: AgenteMiniDto[] = [];
  if (caps.sugerir) {
    for (const x of p.agents) {
      const w = await writeAccessForAgent(user, project, x.agent.id_agent);
      if (w.ok) sugeridores.push(aAgenteMini(x.agent));
    }
  }

  const members: SubagenteDto[] = filas.map((f) => {
    const u = uso.get(f.slug);
    const agente = f.id_agent ? agentes.get(f.id_agent) : undefined;
    return {
      id: f.id_subagent,
      slug: f.slug,
      ...aValores(f),
      status: esEstadoSubagente(f.status) ? f.status : 'descartado',
      origin: f.origin === 'persona' ? 'persona' : 'agente',
      suggestedBy: agente ? agente.display_name : null,
      createdAt: f.created_at.toISOString(),
      reviewedBy: persona(f.reviewed_by),
      reviewedAt: f.reviewed_at ? f.reviewed_at.toISOString() : null,
      uso30d: { corridas: u?.corridas ?? 0, tokens: u?.tokens ?? 0, ultima: u?.ultima ? u.ultima.toISOString() : null },
    };
  });

  let pedidoDto: PedidoEquipoDto | null = null;
  if (pedido) {
    const ag = agentes.get(pedido.id_agent);
    pedidoDto = {
      id: pedido.id_request,
      status: pedido.status as PedidoEquipoDto['status'],
      requestedAt: pedido.requested_at.toISOString(),
      finishedAt: pedido.finished_at ? pedido.finished_at.toISOString() : null,
      requestedBy: persona(pedido.requested_by),
      agent: ag ? aAgenteMini(ag) : null,
      error: pedido.error,
      suggested: pedido.suggested,
    };
  }

  const corridasDto: CorridaSubagenteDto[] = corridas.map((c) => ({
    id: c.id_run,
    slug: c.slug,
    name: nombreDeSlug.get(c.slug) ?? c.slug,
    description: c.description,
    status: c.status === 'ok' || c.status === 'error' ? c.status : 'cancelado',
    conversation: titulo.has(c.id_conversation) ? { id: c.id_conversation, title: titulo.get(c.id_conversation) ?? null } : null,
    startedAt: (c.started_at ?? c.created_at).toISOString(),
    durationMs: c.duration_ms,
    totalTokens: c.total_tokens,
    toolUses: c.tool_uses,
    model: c.model,
  }));

  return {
    enabled: p.team_enabled,
    maxParallel: p.team_max_parallel,
    topeMaximo: TOPE_SIMULTANEOS_MAX,
    profundidad: PROFUNDIDAD_SUBAGENTES,
    maxEquipo: MAX_EQUIPO,
    disponibles: herramientasDisponibles(project.profile),
    profileLabel: profileLabel(project.profile),
    capacidades: caps,
    editorAprueba: editorApruebaEquipo(),
    sugeridores,
    members,
    pedido: pedidoDto,
    corridas: corridasDto,
    consumo30d: {
      corridas: usoPorSub.reduce((a, u) => a + u.corridas, 0),
      tokens: usoPorSub.reduce((a, u) => a + u.tokens, 0),
    },
  };
}

/** Subagentes APROBADOS que cuenta el detalle del proyecto (para el contador de la sección). */
export async function contarEquipo(idProject: number): Promise<number> {
  return prisma.chatProjectSubagent.count({ where: { id_project: idProject, status: 'aprobado' } });
}

/* ─────────────────────────────── Persona ─────────────────────────────── */

/**
 * «Sugerir equipo». Deja un pedido que atiende el puente del agente escogido
 * (o el primero al que la persona le puede escribir).
 */
export async function pedirSugerencia(user: ProjectUser, project: ProjectAccess, raw: { agentCode?: unknown }): Promise<{ idRequest: number }> {
  const caps = capacidadesEquipo(project.role, project.archived, editorApruebaEquipo());
  if (project.archived) throw new ProyectoError('El proyecto está archivado. Restáurelo para hacer cambios.', 403);
  if (!caps.sugerir) throw new ProyectoError('Solo el dueño y los editores pueden pedir una sugerencia de equipo.', 403);

  const designados = await prisma.chatProjectAgent.findMany({
    where: { id_project: project.idProject },
    select: { agent: { select: { id_agent: true, code: true, display_name: true } } },
    orderBy: { added_at: 'asc' },
  });
  const code = typeof raw.agentCode === 'string' ? raw.agentCode.trim().toLowerCase() : '';
  const candidatos = code ? designados.filter((d) => d.agent.code === code) : designados;
  if (code && candidatos.length === 0) throw new ProyectoError('Ese asistente no está en el proyecto.', 400);
  let elegido: (typeof designados)[number]['agent'] | null = null;
  let motivo = 'Usted no tiene asignado ninguno de los asistentes del proyecto.';
  for (const c of candidatos) {
    const w = await writeAccessForAgent(user, project, c.agent.id_agent);
    if (w.ok) {
      elegido = c.agent;
      break;
    }
    motivo = w.motivo;
  }
  if (!elegido) throw new ProyectoError(motivo, 403);

  await vencerPedidos({ id_project: project.idProject });
  const abierto = await prisma.chatProjectTeamRequest.findFirst({
    where: { id_project: project.idProject, status: { in: ['pendiente', 'en_curso'] } },
    select: { id_request: true },
  });
  if (abierto) throw new ProyectoError('Ya hay una sugerencia de equipo en curso. Espere a que termine.', 409);
  const hoy = await prisma.chatProjectTeamRequest.count({
    where: { id_project: project.idProject, requested_at: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
  });
  if (hoy >= MAX_PEDIDOS_DIA) throw new ProyectoError(`Este proyecto ya pidió ${MAX_PEDIDOS_DIA} sugerencias hoy. Intente mañana.`, 429);

  const idAgent = elegido.id_agent;
  const nombreAgente = elegido.display_name;
  return prisma.$transaction(async (tx) => {
    const r = await tx.chatProjectTeamRequest.create({
      data: { id_project: project.idProject, id_agent: idAgent, requested_by: user.id },
      select: { id_request: true },
    });
    await registrarEventoEquipo(tx, {
      idProject: project.idProject,
      action: 'pedir',
      detail: `Pidió a ${nombreAgente} una sugerencia de equipo.`,
      idUser: user.id,
      idAgent,
      via: 'web',
    });
    return { idRequest: r.id_request };
  });
}

/** Aprobar, editar, descartar o restaurar UN subagente. */
export async function actualizarSubagente(
  user: ProjectUser,
  project: ProjectAccess,
  idSubagent: unknown,
  raw: Record<string, unknown>
): Promise<{ status: string }> {
  const caps = capacidadesEquipo(project.role, project.archived, editorApruebaEquipo());
  if (project.archived) throw new ProyectoError('El proyecto está archivado. Restáurelo para hacer cambios.', 403);
  if (!caps.aprobar) {
    throw new ProyectoError(
      project.role === 'editor' ? 'Solo el dueño del proyecto aprueba y cambia el equipo.' : 'Usted no puede cambiar el equipo de este proyecto.',
      403
    );
  }
  const id = Number(idSubagent);
  if (!Number.isInteger(id) || id <= 0) throw new ProyectoError('Subagente no encontrado.', 404);
  const fila = await prisma.chatProjectSubagent.findFirst({ where: { id_subagent: id, id_project: project.idProject } });
  if (!fila) throw new ProyectoError('Subagente no encontrado.', 404);

  const accion = raw.action;
  if (accion !== undefined && accion !== 'aprobar' && accion !== 'descartar' && accion !== 'restaurar') {
    throw new ProyectoError('Acción no válida.', 400);
  }
  const editaCampos = ['name', 'purpose', 'instructions', 'tools', 'model'].some((k) => raw[k] !== undefined);
  if (!accion && !editaCampos) throw new ProyectoError('No hay cambios.', 400);
  if (fila.status === 'descartado' && editaCampos && accion !== 'restaurar') {
    throw new ProyectoError('Restaure el subagente antes de editarlo.', 409);
  }

  const antes = aValores(fila);
  let despues = antes;
  if (editaCampos) {
    const v = normalizarMiembro({ ...antes, ...raw }, herramientasDisponibles(project.profile));
    if (!v.ok) throw new ProyectoError(v.error, 400);
    despues = v.value;
  }
  const cambios = diferencias(antes, despues);

  let status = fila.status;
  if (accion === 'aprobar') {
    if (fila.status === 'aprobado' && Object.keys(cambios).length === 0) throw new ProyectoError('El subagente ya está aprobado.', 409);
    if (fila.status !== 'aprobado') {
      const aprobados = await prisma.chatProjectSubagent.count({ where: { id_project: project.idProject, status: 'aprobado' } });
      if (aprobados >= MAX_EQUIPO) throw new ProyectoError(`El equipo admite máximo ${MAX_EQUIPO} subagentes aprobados.`, 409);
    }
    status = 'aprobado';
  } else if (accion === 'descartar') {
    status = 'descartado';
  } else if (accion === 'restaurar') {
    if (fila.status !== 'descartado') throw new ProyectoError('Solo se restaura un subagente descartado.', 409);
    const vivos = await prisma.chatProjectSubagent.count({ where: { id_project: project.idProject, status: { not: 'descartado' } } });
    if (vivos >= MAX_SUBAGENTES_VIVOS) throw new ProyectoError('Hay demasiados subagentes propuestos. Descarte alguno primero.', 409);
    status = 'propuesto';
  }

  // Un slug repetido entre los no descartados no se admite (índice filtrado en la base).
  let slug = fila.slug;
  if (fila.status === 'descartado' && status !== 'descartado') {
    const ocupados = await prisma.chatProjectSubagent.findMany({
      where: { id_project: project.idProject, status: { not: 'descartado' }, id_subagent: { not: id } },
      select: { slug: true },
    });
    const set = new Set(ocupados.map((o) => o.slug));
    if (set.has(slug)) slug = slugDe(despues.name, set);
  }

  const ahora = new Date();
  const acciones: string[] = [];
  if (Object.keys(cambios).length > 0) acciones.push('editar');
  if (status !== fila.status) acciones.push(accion as string);

  await prisma.$transaction(async (tx) => {
    await tx.chatProjectSubagent.update({
      where: { id_subagent: id },
      data: {
        slug,
        name: despues.name,
        purpose: despues.purpose,
        instructions: despues.instructions,
        tools: herramientasADb(despues.tools),
        model: despues.model,
        status,
        updated_by: user.id,
        updated_at: ahora,
        ...(status !== fila.status ? { reviewed_by: user.id, reviewed_at: ahora } : {}),
      },
    });
    for (const a of acciones) {
      const texto =
        a === 'editar'
          ? `Editó el subagente «${despues.name}».`
          : a === 'aprobar'
            ? `Aprobó el subagente «${despues.name}».`
            : a === 'descartar'
              ? `Descartó el subagente «${despues.name}».`
              : `Restauró el subagente «${despues.name}» como propuesto.`;
      await registrarEventoEquipo(tx, {
        idProject: project.idProject,
        idSubagent: id,
        action: a,
        detail: texto,
        changes: a === 'editar' ? cambios : { status: [fila.status, status] },
        idUser: user.id,
        via: 'web',
      });
    }
    await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: ahora } });
  });
  return { status };
}

/** Encender/apagar el equipo y el tope de subagentes a la vez (solo el dueño). */
export async function configurarEquipo(user: ProjectUser, project: ProjectAccess, raw: Record<string, unknown>): Promise<void> {
  const caps = capacidadesEquipo(project.role, project.archived, editorApruebaEquipo());
  if (project.archived) throw new ProyectoError('El proyecto está archivado. Restáurelo para hacer cambios.', 403);
  if (!caps.configurar) throw new ProyectoError('Solo el dueño del proyecto configura el equipo.', 403);
  const v = normalizarConfig(raw);
  if (!v.ok) throw new ProyectoError(v.error, 400);
  const antes = await prisma.chatProject.findUnique({
    where: { id_project: project.idProject },
    select: { team_enabled: true, team_max_parallel: true },
  });
  if (!antes) throw new ProyectoError('Proyecto no encontrado.', 404);
  const changes: Record<string, [unknown, unknown]> = {};
  if (v.value.enabled !== undefined && v.value.enabled !== antes.team_enabled) changes.enabled = [antes.team_enabled, v.value.enabled];
  if (v.value.maxParallel !== undefined && v.value.maxParallel !== antes.team_max_parallel) changes.maxParallel = [antes.team_max_parallel, v.value.maxParallel];
  if (Object.keys(changes).length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.chatProject.update({
      where: { id_project: project.idProject },
      data: {
        ...(v.value.enabled !== undefined ? { team_enabled: v.value.enabled } : {}),
        ...(v.value.maxParallel !== undefined ? { team_max_parallel: v.value.maxParallel } : {}),
      },
    });
    const partes: string[] = [];
    if (changes.enabled) partes.push(v.value.enabled ? 'encendió el equipo' : 'apagó el equipo');
    if (changes.maxParallel) partes.push(`cambió el tope a ${v.value.maxParallel} subagentes a la vez`);
    await registrarEventoEquipo(tx, {
      idProject: project.idProject,
      action: 'configurar',
      detail: `${partes.join(' y ')}.`.replace(/^./, (c) => c.toUpperCase()),
      changes,
      idUser: user.id,
      via: 'web',
    });
  });
}

/* ─────────────────────────────── Puente ─────────────────────────────── */

/** Proyectos donde ESTE agente puede atender (activo, designado y con su perfil habilitado). */
async function whereProyectoAtendible(idAgent: number, code: string): Promise<Prisma.ChatProjectWhereInput> {
  // Empresa y perfil habilitados para el agente (configuración del módulo; sin configurar, el .env).
  const filtro = (await cargarConfigProyectos()).filtroAtendible(code) as Prisma.ChatProjectWhereInput;
  // El filtro solo trae id_company / profile / OR: no pisa archived ni agents.
  return { archived: false, agents: { some: { id_agent: idAgent } }, ...filtro };
}

/**
 * El puente RECLAMA los pedidos pendientes de su agente (máximo 3 por vez) y
 * recibe, de cada uno, la ficha del proyecto: lo mismo que ven los miembros.
 */
export async function reclamarPedidos(agent: { idAgent: number; code: string }) {
  await vencerPedidos({ id_agent: agent.idAgent });
  const pendientes = await prisma.chatProjectTeamRequest.findMany({
    where: { id_agent: agent.idAgent, status: 'pendiente', project: await whereProyectoAtendible(agent.idAgent, agent.code) },
    orderBy: { requested_at: 'asc' },
    take: 3,
    select: { id_request: true, id_project: true },
  });
  const out = [];
  for (const p of pendientes) {
    // Reclamo atómico: si otra instancia ya lo tomó, no se repite.
    const r = await prisma.chatProjectTeamRequest.updateMany({
      where: { id_request: p.id_request, status: 'pendiente' },
      data: { status: 'en_curso', claimed_at: new Date() },
    });
    if (r.count !== 1) continue;
    out.push({ idRequest: p.id_request, idProject: p.id_project, ...(await fichaParaSugerencia(p.id_project)) });
  }
  return out;
}

/** Ficha del proyecto para la sugerencia: nombres y títulos, nunca cuerpos de correo. */
async function fichaParaSugerencia(idProject: number) {
  const p = await prisma.chatProject.findUnique({
    where: { id_project: idProject },
    select: {
      name: true,
      description: true,
      instructions: true,
      profile: true,
      company: { select: { company: true } },
      files: { select: { file_name: true }, take: 30 },
      subagents: { where: { status: 'aprobado' }, select: { name: true, purpose: true } },
    },
  });
  if (!p) throw new ProyectoError('Proyecto no encontrado.', 404);
  const vinculos = await vinculosDelProyecto(idProject, null);
  let tareas: string[] = [];
  try {
    const c = await cronogramaParaAgente(idProject);
    tareas = c.tasks.map((t) => `${t.title} (${t.startDate} → ${t.endDate}, ${t.status})`);
  } catch {
    // El cronograma es un adorno de la ficha.
  }
  return {
    project: {
      name: p.name,
      companyName: p.company.company.trim(),
      profileKey: p.profile,
      profileLabel: profileLabel(p.profile),
      description: p.description,
      instructions: p.instructions,
    },
    files: p.files.map((f) => f.file_name),
    emails: vinculos.emails.map((e) => e.subject),
    requests: vinculos.requests.map((r) => `#${r.idRequest} ${r.subject} (${r.processName ?? 'sin proceso'})`),
    tasks: tareas,
    team: p.subagents.map((s) => `${s.name}: ${s.purpose}`),
  };
}

/**
 * El puente entrega la sugerencia (o el error). Los subagentes quedan
 * PROPUESTOS; los propuestos de una sugerencia anterior que nadie revisó se
 * descartan (quedan en la auditoría).
 */
export async function entregarSugerencia(agent: { idAgent: number; code: string }, payload: Record<string, unknown>) {
  const idRequest = Number(payload.idRequest);
  if (!Number.isInteger(idRequest) || idRequest <= 0) throw new ProyectoError('Pedido no encontrado.', 404);
  const pedido = await prisma.chatProjectTeamRequest.findFirst({
    where: { id_request: idRequest, id_agent: agent.idAgent, status: 'en_curso', project: await whereProyectoAtendible(agent.idAgent, agent.code) },
    select: { id_request: true, id_project: true, project: { select: { profile: true } } },
  });
  if (!pedido) throw new ProyectoError('Pedido no encontrado.', 404);

  const tokens = (payload.tokens ?? {}) as Record<string, unknown>;
  const totalTokens = ['input', 'cacheCreation', 'cacheRead', 'output'].reduce((a, k) => a + Math.max(0, Math.min(Math.trunc(Number(tokens[k] ?? 0)) || 0, 2_000_000_000)), 0);
  const models = Array.isArray(payload.models) ? payload.models.map((m) => String(m)).join(', ').slice(0, 300) || null : null;
  const ahora = new Date();

  if (typeof payload.error === 'string' || !Array.isArray(payload.items)) {
    const error = (typeof payload.error === 'string' ? payload.error : 'El asistente no devolvió una propuesta.').slice(0, 300);
    await prisma.$transaction(async (tx) => {
      await tx.chatProjectTeamRequest.update({
        where: { id_request: idRequest },
        data: { status: 'fallida', finished_at: ahora, error, total_tokens: Math.min(totalTokens, 2_000_000_000), models },
      });
      await registrarEventoEquipo(tx, { idProject: pedido.id_project, action: 'fallar', detail: `La sugerencia de equipo falló: ${error}`, idAgent: agent.idAgent, via: 'puente' });
    });
    return { creados: 0, rechazados: 0 };
  }

  const disponibles = herramientasDisponibles(pedido.project.profile);
  const validos: MiembroValores[] = [];
  let rechazados = 0;
  for (const item of payload.items.slice(0, MAX_SUGERIDOS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      rechazados += 1;
      continue;
    }
    const v = normalizarMiembro(item as Record<string, unknown>, disponibles, { tolerante: true });
    if (v.ok) validos.push(v.value);
    else rechazados += 1;
  }
  rechazados += Math.max(0, payload.items.length - MAX_SUGERIDOS);

  await prisma.$transaction(async (tx) => {
    const viejos = await tx.chatProjectSubagent.findMany({
      where: { id_project: pedido.id_project, status: 'propuesto' },
      select: { id_subagent: true, name: true },
    });
    if (validos.length > 0) {
      for (const v of viejos) {
        await tx.chatProjectSubagent.update({ where: { id_subagent: v.id_subagent }, data: { status: 'descartado', updated_at: ahora } });
        await registrarEventoEquipo(tx, {
          idProject: pedido.id_project,
          idSubagent: v.id_subagent,
          action: 'descartar',
          detail: `«${v.name}» quedó descartado: lo reemplazó una sugerencia nueva.`,
          idAgent: agent.idAgent,
          via: 'puente',
        });
      }
    }
    const ocupados = new Set(
      (await tx.chatProjectSubagent.findMany({ where: { id_project: pedido.id_project, status: { not: 'descartado' } }, select: { slug: true } })).map((s) => s.slug)
    );
    for (const v of validos) {
      const slug = slugDe(v.name, ocupados);
      ocupados.add(slug);
      const creado = await tx.chatProjectSubagent.create({
        data: {
          id_project: pedido.id_project,
          slug,
          name: v.name,
          purpose: v.purpose,
          instructions: v.instructions,
          tools: herramientasADb(v.tools),
          model: v.model,
          status: 'propuesto',
          origin: 'agente',
          id_request: idRequest,
          id_agent: agent.idAgent,
        },
        select: { id_subagent: true },
      });
      await registrarEventoEquipo(tx, {
        idProject: pedido.id_project,
        idSubagent: creado.id_subagent,
        action: 'sugerir',
        detail: `Sugirió el subagente «${v.name}».`,
        changes: { tools: v.tools, model: v.model },
        idAgent: agent.idAgent,
        via: 'puente',
      });
    }
    await tx.chatProjectTeamRequest.update({
      where: { id_request: idRequest },
      data: {
        status: validos.length > 0 ? 'lista' : 'fallida',
        finished_at: ahora,
        suggested: validos.length,
        error: validos.length > 0 ? null : 'La propuesta no traía subagentes válidos.',
        total_tokens: Math.min(totalTokens, 2_000_000_000),
        models,
      },
    });
  });
  return { creados: validos.length, rechazados };
}

/** Equipo APROBADO para el contexto del puente (lo único que llega al proceso del modelo). */
export async function equipoParaAgente(idProject: number) {
  const p = await prisma.chatProject.findUnique({
    where: { id_project: idProject },
    select: {
      team_enabled: true,
      team_max_parallel: true,
      subagents: { where: { status: 'aprobado' }, orderBy: [{ created_at: 'asc' }, { id_subagent: 'asc' }], take: MAX_EQUIPO },
    },
  });
  if (!p) return { enabled: false, maxParallel: 1, members: [] };
  return {
    enabled: p.team_enabled,
    maxParallel: Math.max(1, Math.min(p.team_max_parallel, TOPE_SIMULTANEOS_MAX)),
    members: p.subagents.map((s) => ({ slug: s.slug, ...aValores(s) })),
  };
}

/**
 * El puente registra lo que hizo cada subagente en un turno de UNA
 * conversación del proyecto (ya verificada contra el agente de la llave).
 */
export async function registrarCorridas(
  agent: { idAgent: number },
  conv: { id: number; idProject: number },
  payload: Record<string, unknown>
): Promise<{ registradas: number }> {
  const crudas = Array.isArray(payload.runs) ? payload.runs.slice(0, MAX_CORRIDAS_POR_TURNO) : [];
  const corridas = crudas.map(normalizarCorrida).filter((c): c is NonNullable<typeof c> => c !== null);
  const bloqueos = Array.isArray(payload.blocked) ? payload.blocked.filter((b) => typeof b === 'string').slice(0, 5) : [];
  if (corridas.length === 0 && bloqueos.length === 0) return { registradas: 0 };
  const subs = await prisma.chatProjectSubagent.findMany({
    where: { id_project: conv.idProject, slug: { in: corridas.map((c) => c.slug) }, status: { not: 'descartado' } },
    select: { id_subagent: true, slug: true },
  });
  const idDe = new Map(subs.map((s) => [s.slug, s.id_subagent]));
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.slice(0, 120) : null;
  const turno = payload.turnStartedAt ? new Date(String(payload.turnStartedAt)) : null;
  const turnStartedAt = turno && !Number.isNaN(turno.getTime()) ? turno : null;

  await prisma.$transaction(async (tx) => {
    if (corridas.length > 0) {
      await tx.chatProjectSubagentRun.createMany({
        data: corridas.map((c) => ({
          id_project: conv.idProject,
          id_conversation: conv.id,
          id_agent: agent.idAgent,
          id_subagent: idDe.get(c.slug) ?? null,
          slug: c.slug,
          description: c.description,
          status: c.status,
          session_id: sessionId,
          turn_started_at: turnStartedAt,
          started_at: c.startedAt,
          ended_at: c.endedAt,
          duration_ms: c.durationMs,
          total_tokens: c.totalTokens,
          tool_uses: c.toolUses,
          model: c.model,
        })),
      });
    }
    if (bloqueos.length > 0) {
      await registrarEventoEquipo(tx, {
        idProject: conv.idProject,
        action: 'bloqueo',
        detail: `El puente detuvo un turno de la conversación ${conv.id}: ${bloqueos.join(' · ')}`.slice(0, 1000),
        changes: { bloqueos },
        idAgent: agent.idAgent,
        via: 'puente',
      });
    }
  });
  return { registradas: corridas.length };
}
