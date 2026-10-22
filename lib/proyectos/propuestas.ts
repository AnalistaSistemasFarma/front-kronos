/**
 * PROPUESTAS de los agentes sobre un proyecto — capa de datos (2026-10-18).
 * Las reglas puras y el porqué están en lib/proyectos/propuestas-rules.ts.
 *
 * GARANTÍAS:
 *   1. Una propuesta sin confirmar NO cambia nada: solo existe la fila
 *      'pendiente' y su auditoría.
 *   2. Al confirmar se ejecuta con la identidad, el rol y la visibilidad de
 *      QUIEN CONFIRMA, revalidados en ese instante (las mismas funciones que
 *      usan las pantallas: crearTarea, vincularSolicitud, …).
 *   3. Un candado (pendiente → ejecutando con UPDATE condicionado) impide que
 *      dos clics la ejecuten dos veces.
 *   4. Todo queda en chat_project_event: proponer, confirmar, rechazar, fallar.
 */
import { prisma } from '../prisma';
import { capabilitiesFor } from '../chat/projects-rules';
import { eligibleProjectUsers, type ProjectAccess, type ProjectUser } from '../chat/projects';
import { quitarVinculo, vincularSolicitud } from '../chat/projects-links';
import type { PropuestaDto } from './tipos';
import { crearConversacionProyecto, errorDeProyecto, invitarMiembros, ProyectoError } from './acciones';
import { crearTarea, editarTarea, miembroPorReferencia, registrarEvento } from './cronograma';
import {
  MAX_PENDING_PROPOSALS,
  MAX_PROPOSALS_PER_TURN,
  PROPOSAL_KIND_LABELS,
  PROPOSAL_TTL_MS,
  PUENTE_KINDS,
  isProposalKind,
  puedeConfirmar,
  resumenPropuesta,
  validarPropuesta,
  type Payload,
  type PayloadTarea,
  type ProposalSource,
} from './propuestas-rules';

const agenteMini = { id_agent: true, code: true, display_name: true, handle: true, avatar_url: true, avatar_updated_at: true } as const;

/** Vence las pendientes cuyo plazo pasó (perezoso: al leer). */
async function vencerPendientes(idProject: number): Promise<void> {
  await prisma.chatProjectProposal.updateMany({
    where: { id_project: idProject, status: 'pendiente', expires_at: { lte: new Date() } },
    data: { status: 'vencida', decided_at: new Date() },
  });
}

/** Propuestas PENDIENTES del proyecto tal como las ve esta persona. */
export async function propuestasPendientes(user: ProjectUser, project: ProjectAccess): Promise<PropuestaDto[]> {
  await vencerPendientes(project.idProject);
  const filas = await prisma.chatProjectProposal.findMany({
    where: { id_project: project.idProject, status: 'pendiente' },
    orderBy: { id_proposal: 'asc' },
    take: MAX_PENDING_PROPOSALS,
  });
  if (filas.length === 0) return [];
  const [agentes, personas] = await Promise.all([
    prisma.agent.findMany({ where: { id_agent: { in: [...new Set(filas.map((f) => f.id_agent))] } }, select: agenteMini }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(filas.map((f) => f.requested_for).filter((x): x is string => !!x))] } },
      select: { id: true, name: true, email: true },
    }),
  ]);
  const porAgente = new Map(agentes.map((a) => [a.id_agent, a]));
  const porPersona = new Map(personas.map((p) => [p.id, p.name?.trim() || p.email]));
  const caps = project.archived ? capabilitiesFor(null) : capabilitiesFor(project.role);
  return filas.map((f) => {
    const kind = isProposalKind(f.kind) ? f.kind : 'tarea_crear';
    const decision = project.archived
      ? { ok: false as const, motivo: 'El proyecto está archivado.' }
      : puedeConfirmar({ source: f.source as ProposalSource, requestedFor: f.requested_for, kind }, { id: user.id, caps });
    const a = porAgente.get(f.id_agent);
    return {
      id: f.id_proposal,
      kind: f.kind,
      kindLabel: PROPOSAL_KIND_LABELS[kind],
      summary: f.summary,
      source: f.source === 'mcp' ? 'mcp' : 'puente',
      agent: a
        ? {
            idAgent: a.id_agent,
            code: a.code,
            displayName: a.display_name,
            handle: a.handle,
            avatarUrl: a.avatar_url,
            avatarVersion: a.avatar_updated_at ? a.avatar_updated_at.getTime() : null,
          }
        : null,
      requestedFor: f.requested_for ? { id: f.requested_for, name: porPersona.get(f.requested_for) ?? 'Persona retirada' } : null,
      createdAt: f.created_at.toISOString(),
      expiresAt: f.expires_at.toISOString(),
      puedoConfirmar: decision.ok,
      motivo: decision.ok ? null : decision.motivo,
    };
  });
}

/* ───────────────────────────── Desde el puente ───────────────────────────── */

/**
 * Propuestas que el modelo de una conversación DEL PROYECTO dejó en
 * ./trabajo/propuestas-cronograma.json. La ruta ya validó la llave del puente
 * y la conversación (assertAgentProjectConversation). Solo tareas.
 */
export async function crearPropuestasDelPuente(
  conv: { id: number; idProject: number },
  idAgent: number,
  items: unknown
): Promise<{ creadas: number[]; rechazadas: { indice: number; error: string }[] }> {
  if (!Array.isArray(items)) throw new ProyectoError('Se esperaba una lista de propuestas.', 400);
  const rechazadas: { indice: number; error: string }[] = [];
  const validas: { indice: number; payload: Payload; resumen: string }[] = [];
  const lista = items.slice(0, MAX_PROPOSALS_PER_TURN);
  for (let i = items.length; i > MAX_PROPOSALS_PER_TURN; i--) rechazadas.push({ indice: i - 1, error: `Máximo ${MAX_PROPOSALS_PER_TURN} propuestas por respuesta.` });

  await vencerPendientes(conv.idProject);
  const pendientes = await prisma.chatProjectProposal.count({ where: { id_project: conv.idProject, status: 'pendiente' } });
  let cupo = Math.max(0, MAX_PENDING_PROPOSALS - pendientes);

  for (let i = 0; i < lista.length; i++) {
    const v = validarPropuesta(lista[i], PUENTE_KINDS);
    if (!v.ok) {
      rechazadas.push({ indice: i, error: v.error });
      continue;
    }
    let titulo: string | null = null;
    if (v.value.kind === 'tarea_editar') {
      const t = await prisma.chatProjectTask.findFirst({ where: { id_project_task: v.value.idTask, id_project: conv.idProject }, select: { title: true } });
      if (!t) {
        rechazadas.push({ indice: i, error: `La tarea #${v.value.idTask} no es de este proyecto.` });
        continue;
      }
      titulo = t.title;
    }
    if (cupo <= 0) {
      rechazadas.push({ indice: i, error: `El proyecto ya tiene ${MAX_PENDING_PROPOSALS} propuestas pendientes.` });
      continue;
    }
    cupo--;
    validas.push({ indice: i, payload: v.value, resumen: resumenPropuesta(v.value, { tituloTarea: titulo }) });
  }

  const creadas: number[] = [];
  if (validas.length > 0) {
    const ahora = new Date();
    await prisma.$transaction(async (tx) => {
      for (const p of validas) {
        const f = await tx.chatProjectProposal.create({
          data: {
            id_project: conv.idProject,
            kind: p.payload.kind,
            payload: JSON.stringify(p.payload),
            summary: p.resumen,
            status: 'pendiente',
            source: 'puente',
            id_agent: idAgent,
            id_conversation: conv.id,
            created_at: ahora,
            expires_at: new Date(ahora.getTime() + PROPOSAL_TTL_MS),
          },
          select: { id_proposal: true },
        });
        creadas.push(f.id_proposal);
        await registrarEvento(tx, {
          idProject: conv.idProject,
          entity: 'propuesta',
          idEntity: f.id_proposal,
          action: 'proponer',
          detail: `${p.resumen} (conversación #${conv.id}). Pendiente de confirmación.`,
          idUser: null,
          idAgent,
          via: 'puente',
        });
      }
    });
  }
  return { creadas, rechazadas };
}

/* ───────────────────────────── Confirmar / rechazar ───────────────────────────── */

async function propuestaDelProyecto(project: ProjectAccess, idProposal: unknown) {
  if (typeof idProposal !== 'number' || !Number.isInteger(idProposal) || idProposal <= 0) throw new ProyectoError('Propuesta no encontrada.', 404);
  const p = await prisma.chatProjectProposal.findFirst({ where: { id_proposal: idProposal, id_project: project.idProject } });
  if (!p) throw new ProyectoError('Propuesta no encontrada.', 404);
  return p;
}

function exigirDecidible(p: { status: string; expires_at: Date }): void {
  if (p.status !== 'pendiente') throw new ProyectoError('Esa propuesta ya se decidió.', 409);
  if (p.expires_at.getTime() <= Date.now()) throw new ProyectoError('La propuesta venció. Pídale al asistente que la vuelva a hacer.', 410);
}

/** Campos de la tarea propuesta → entrada de crearTarea/editarTarea (el responsable, resuelto a un miembro). */
async function tareaDesdePropuesta(idProject: number, t: PayloadTarea): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (t.title !== undefined) out.title = t.title;
  if (t.description !== undefined) out.description = t.description;
  if (t.responsable !== undefined) out.idResponsible = await miembroPorReferencia(idProject, t.responsable);
  if (t.startDate !== undefined) out.startDate = t.startDate;
  if (t.endDate !== undefined) out.endDate = t.endDate;
  if (t.status !== undefined) out.status = t.status;
  if (t.progress !== undefined) out.progress = t.progress;
  if (t.isMilestone !== undefined) out.isMilestone = t.isMilestone;
  return out;
}

async function ejecutar(user: ProjectUser, project: ProjectAccess, payload: Payload, nota: string, via: 'puente' | 'mcp', idAgent: number): Promise<string> {
  const origen = { via, idAgent, nota };
  switch (payload.kind) {
    case 'tarea_crear': {
      const r = await crearTarea(user, project, await tareaDesdePropuesta(project.idProject, payload.tarea), origen);
      return `Tarea #${r.id} creada.`;
    }
    case 'tarea_editar': {
      const r = await editarTarea(user, project, payload.idTask, await tareaDesdePropuesta(project.idProject, payload.tarea), origen);
      return r.cambios === 0 ? 'La tarea ya estaba así: no hubo cambios.' : `Tarea #${r.id} actualizada.`;
    }
    case 'solicitud_vincular': {
      // Visibilidad de QUIEN CONFIRMA (solicitante, responsable de una tarea o del proceso).
      await vincularSolicitud(user, project, payload.idRequest);
      return `Solicitud #${payload.idRequest} vinculada.`;
    }
    case 'solicitud_desvincular': {
      const v = await prisma.chatProjectRequest.findFirst({ where: { id_project: project.idProject, id_request: payload.idRequest }, select: { id_project_request: true } });
      if (!v) throw new ProyectoError('Esa solicitud ya no está en el proyecto.', 404);
      await quitarVinculo(user, project, 'solicitud', v.id_project_request);
      return `Solicitud #${payload.idRequest} quitada del proyecto.`;
    }
    case 'conversacion_crear': {
      const r = await crearConversacionProyecto(user, project, { agentCode: payload.agentCode, title: payload.title });
      return `Conversación #${r.idConversation} abierta.`;
    }
    case 'miembro_invitar': {
      const candidatos = await eligibleProjectUsers(project.idCompany);
      const u = candidatos.find((c) => c.email.toLowerCase() === payload.email);
      if (!u) throw new ProyectoError(`${payload.email} no tiene el permiso «Proyectos» en la empresa del proyecto.`, 409);
      const r = await invitarMiembros(user, project, [u.id], payload.role);
      return r.added === 0 ? 'Esa persona ya era miembro.' : `${u.name} agregada como ${payload.role === 'reader' ? 'lector' : 'editor'}.`;
    }
  }
}

/** Mensaje en la conversación de la propuesta (MCP: le llega al agente; puente: nota del sistema). */
async function contarEnElChat(p: { source: string; id_conversation: number | null }, user: ProjectUser, cuerpo: string): Promise<void> {
  if (!p.id_conversation) return;
  try {
    const t = new Date();
    await prisma.chatMessage.create({
      data:
        p.source === 'mcp'
          ? { id_conversation: p.id_conversation, role: 'user', body: cuerpo, created_at: t, id_user_author: user.id }
          : { id_conversation: p.id_conversation, role: 'system', body: cuerpo, created_at: t, delivered_at: t },
    });
    await prisma.chatConversation.update({ where: { id: p.id_conversation }, data: { last_message_at: t } });
  } catch (err) {
    console.error('[proyectos/propuestas] no se pudo avisar en el chat:', (err as Error).message);
  }
}

export async function confirmarPropuesta(user: ProjectUser, project: ProjectAccess, idProposal: unknown): Promise<{ resultado: string }> {
  if (project.archived) throw new ProyectoError('El proyecto está archivado.', 403);
  const p = await propuestaDelProyecto(project, idProposal);
  exigirDecidible(p);
  const kind = isProposalKind(p.kind) ? p.kind : null;
  if (!kind) throw new ProyectoError('Propuesta inválida.', 400);
  const decision = puedeConfirmar({ source: p.source as ProposalSource, requestedFor: p.requested_for, kind }, { id: user.id, caps: capabilitiesFor(project.role) });
  if (!decision.ok) throw new ProyectoError(decision.motivo, 403);
  // La concesión del MCP debe seguir vigente y ser de esta persona.
  if (p.source === 'mcp') {
    const g = p.id_grant ? await prisma.chatProjectGrant.findFirst({ where: { id_grant: p.id_grant, id_user: user.id } }) : null;
    if (!g || g.revoked_at || g.expires_at.getTime() <= Date.now()) throw new ProyectoError('El acceso que le dio al asistente venció o lo revocó: la propuesta ya no se puede confirmar.', 410);
  }
  // El payload se vuelve a validar (no se confía en lo guardado).
  let parsed: unknown;
  try {
    parsed = JSON.parse(p.payload);
  } catch {
    throw new ProyectoError('Propuesta inválida.', 400);
  }
  const v = validarPropuesta(parsed);
  if (!v.ok || v.value.kind !== kind) throw new ProyectoError('Propuesta inválida.', 400);

  // Candado: solo un clic la ejecuta.
  const candado = await prisma.chatProjectProposal.updateMany({
    where: { id_proposal: p.id_proposal, status: 'pendiente', expires_at: { gt: new Date() } },
    data: { status: 'ejecutando', decided_by: user.id, decided_at: new Date() },
  });
  if (candado.count !== 1) throw new ProyectoError('Esa propuesta ya se decidió.', 409);

  const agente = await prisma.agent.findFirst({ where: { id_agent: p.id_agent }, select: { display_name: true } });
  const nota = `propuesta #${p.id_proposal} de ${agente?.display_name ?? 'un asistente'}, confirmada`;
  try {
    const resultado = await ejecutar(user, project, v.value, nota, p.source === 'mcp' ? 'mcp' : 'puente', p.id_agent);
    await prisma.chatProjectProposal.update({ where: { id_proposal: p.id_proposal }, data: { status: 'confirmada', result: resultado.slice(0, 500) } });
    await registrarEvento(prisma, {
      idProject: project.idProject,
      entity: 'propuesta',
      idEntity: p.id_proposal,
      action: 'confirmar',
      detail: `${p.summary} → ${resultado}`,
      idUser: user.id,
      idAgent: p.id_agent,
      via: 'web',
    });
    await contarEnElChat(p, user, `✅ Confirmé la propuesta #${p.id_proposal} en el proyecto «${project.name}»: ${p.summary}. ${resultado}`);
    return { resultado };
  } catch (err) {
    // Nada se ejecutó (cada acción es todo o nada): vuelve a pendiente para corregir o rechazar.
    const e = errorDeProyecto(err);
    await prisma.chatProjectProposal
      .update({ where: { id_proposal: p.id_proposal }, data: { status: 'pendiente', decided_by: null, decided_at: null, result: (e?.error ?? 'Error inesperado').slice(0, 500) } })
      .catch(() => null);
    await registrarEvento(prisma, {
      idProject: project.idProject,
      entity: 'propuesta',
      idEntity: p.id_proposal,
      action: 'fallar',
      detail: `No se pudo confirmar: ${e?.error ?? (err as Error).message}`,
      idUser: user.id,
      idAgent: p.id_agent,
      via: 'web',
    }).catch(() => null);
    throw err;
  }
}

export async function rechazarPropuesta(user: ProjectUser, project: ProjectAccess, idProposal: unknown): Promise<void> {
  const p = await propuestaDelProyecto(project, idProposal);
  exigirDecidible(p);
  const kind = isProposalKind(p.kind) ? p.kind : 'tarea_crear';
  // Rechazar exige lo mismo que confirmar: el agente no le cierra la puerta a nadie más.
  const decision = puedeConfirmar({ source: p.source as ProposalSource, requestedFor: p.requested_for, kind }, { id: user.id, caps: capabilitiesFor(project.role) });
  if (!decision.ok) throw new ProyectoError(decision.motivo, 403);
  const r = await prisma.chatProjectProposal.updateMany({
    where: { id_proposal: p.id_proposal, status: 'pendiente' },
    data: { status: 'rechazada', decided_by: user.id, decided_at: new Date() },
  });
  if (r.count !== 1) throw new ProyectoError('Esa propuesta ya se decidió.', 409);
  await registrarEvento(prisma, {
    idProject: project.idProject,
    entity: 'propuesta',
    idEntity: p.id_proposal,
    action: 'rechazar',
    detail: `Rechazó: ${p.summary}`,
    idUser: user.id,
    idAgent: p.id_agent,
    via: 'web',
  });
  await contarEnElChat(p, user, `❌ Rechacé la propuesta #${p.id_proposal} en el proyecto «${project.name}»: ${p.summary}.`);
}
