/**
 * MESAS DE DISCUSIÓN — acceso a la base y motor (2026-11-04).
 * Reglas puras en ./mesas-rules.ts; diseño en docs/proyectos-mesas-discusion.md.
 *
 * El MOTOR es perezoso: no hay cron. Avanza en dos momentos:
 *   - tickMesas(): lo llama la bandeja de los puentes de hilos (cada pocos
 *     segundos hay alguno preguntando). Arranca rondas programadas y salta
 *     turnos vencidos. Con un freno en memoria para no consultar en cada vuelta.
 *   - alPublicarAgenteEnMesa(): lo llama la publicación de un agente. Si era
 *     su turno, entrega el siguiente de inmediato.
 *
 * Cada cambio de estado usa BLOQUEO OPTIMISTA (updateMany con ronda y turno
 * esperados): si dos puentes llegan a la vez, solo uno mueve la mesa.
 */
import { prisma } from '../prisma';
import { MAX_TITLE_CHARS } from '../chat/constants';
import { capabilitiesFor, MAX_PROJECT_CONVERSATIONS } from '../chat/projects-rules';
import { writeAccessForAgent, type ProjectAccess, type ProjectUser } from '../chat/projects';
import { ProyectoError } from './acciones';
import {
  decidirTick,
  decidirTrasRespuesta,
  diaCOT,
  esSinAporte,
  instruccionesTurno,
  resumenParaOperador,
  textoAvisoTurno,
  validarMesa,
  MESA_TURNO_VENCE_MS,
  type Decision,
  type EstadoMotor,
  type EstadoMesa,
  type MotivoPausa,
} from './mesas-rules';

export const EVENT_TYPE_TURNO = 'mesa_turno';

const includeMesa = {
  agentes: {
    orderBy: { orden: 'asc' as const },
    include: { agent: { select: { id_agent: true, code: true, display_name: true } } },
  },
  moderador: { select: { id_agent: true, code: true, display_name: true } },
} as const;

type MesaFila = NonNullable<Awaited<ReturnType<typeof cargarMesa>>>;

async function cargarMesa(where: { id_mesa: number } | { id_conversation: number }) {
  return prisma.chatProjectMesa.findUnique({ where, include: includeMesa });
}

function aEstadoMotor(m: MesaFila): EstadoMotor {
  return {
    estado: m.estado as EstadoMesa,
    reglas: {
      ritmoMin: m.ritmo_min,
      topeDia: m.tope_dia,
      sintesisCada: m.sintesis_cada,
      horarioDesde: m.horario_desde,
      horarioHasta: m.horario_hasta,
      soloHabiles: m.solo_habiles,
    },
    participantes: m.agentes.map((a) => ({ idAgent: a.id_agent, rol: a.rol })),
    idAgentModerador: m.id_agent_moderador,
    ronda: m.ronda,
    turnoIdx: m.turno_idx,
    turnoDesde: m.turno_desde,
    proximoTurnoAt: m.proximo_turno_at,
    turnosHoy: m.turnos_hoy,
    turnosDia: m.turnos_dia,
    aportesRonda: m.aportes_ronda,
  };
}

/** El «@handle» de un agente para el aviso (el code, que es como se le menciona). */
function handleDe(a: { code: string }): string {
  return a.code;
}

function nombreAgente(m: MesaFila, idAgent: number): { nombre: string; handle: string } {
  const p = m.agentes.find((a) => a.id_agent === idAgent)?.agent ?? (m.moderador.id_agent === idAgent ? m.moderador : null);
  return { nombre: p?.display_name ?? 'Asistente', handle: p ? handleDe(p) : 'asistente' };
}

/**
 * Aplica una decisión del motor. Devuelve false si otra petición ya movió la
 * mesa (bloqueo optimista) y no se hizo nada.
 */
async function aplicarDecision(m: MesaFila, d: Decision, ahora: Date, origen: { idUser?: string } = {}): Promise<boolean> {
  if (d.tipo === 'nada') return false;
  const esperado = { id_mesa: m.id_mesa, ronda: m.ronda, turno_idx: m.turno_idx, estado: m.estado };

  return prisma.$transaction(async (tx) => {
    const eventos: { tipo: string; ronda?: number | null; id_agent?: number | null; id_user?: string | null; id_message?: number | null; detalle?: string | null }[] = [];
    if (d.vencido) {
      eventos.push({
        tipo: 'vencido',
        ronda: m.ronda,
        id_agent: d.vencido.idAgent,
        detalle: `${nombreAgente(m, d.vencido.idAgent).nombre} no respondió a tiempo; la mesa siguió con el turno siguiente.`,
      });
    }

    if (d.tipo === 'entregar') {
      const t = d.turno;
      const { nombre, handle } = nombreAgente(m, t.idAgent);
      const nuevaRonda = t.ronda !== m.ronda || m.turno_idx === -1;
      const hoy = diaCOT(ahora);
      const turnosHoy = (m.turnos_dia === hoy ? m.turnos_hoy : 0) + 1;
      const r = await tx.chatProjectMesa.updateMany({
        where: esperado,
        data: {
          ronda: t.ronda,
          turno_idx: t.turnoIdx,
          turno_desde: ahora,
          proximo_turno_at: null,
          turnos_hoy: turnosHoy,
          turnos_dia: hoy,
          ...(nuevaRonda && t.turnoIdx === 0 ? { aportes_ronda: 0 } : {}),
          updated_at: ahora,
        },
      });
      if (r.count === 0) return false;
      // Aporte del turno anterior: se cuenta al publicar (alPublicarAgenteEnMesa).
      const aviso = await tx.chatMessage.create({
        data: {
          id_conversation: m.id_conversation,
          role: 'system',
          event_type: EVENT_TYPE_TURNO,
          body: textoAvisoTurno({ turno: t, handle, nombre, totalParticipantes: m.agentes.length }),
          created_at: ahora,
          // Nace entregado para el MODERADOR como dueño del hilo: el turno viaja
          // SOLO por la fila de entrega del agente de turno (puede ser él mismo).
          delivered_at: ahora,
          deliveries: { create: [{ id_agent: t.idAgent }] },
        },
        select: { id: true },
      });
      await tx.chatProjectMesa.update({ where: { id_mesa: m.id_mesa }, data: { id_message_turno: aviso.id } });
      await tx.chatConversation.update({ where: { id: m.id_conversation }, data: { last_message_at: ahora } });
      eventos.push({
        tipo: 'turno',
        ronda: t.ronda,
        id_agent: t.idAgent,
        id_message: aviso.id,
        detalle: t.esSintesis ? `${nombre} hace la síntesis de la ronda ${t.ronda}.` : `Le toca a ${nombre} (${t.rol}).`,
      });
    } else if (d.tipo === 'programar') {
      const r = await tx.chatProjectMesa.updateMany({
        where: esperado,
        data: { turno_idx: -1, turno_desde: null, proximo_turno_at: d.at, updated_at: ahora },
      });
      if (r.count === 0) return false;
      if (d.porTope) {
        eventos.push({ tipo: 'tope', ronda: m.ronda, detalle: `Se llegó al tope de ${m.tope_dia} turnos del día; la mesa sigue mañana.` });
      }
    } else if (d.tipo === 'pausar') {
      const r = await tx.chatProjectMesa.updateMany({
        where: esperado,
        data: { estado: 'pausada', motivo_pausa: d.motivo, turno_idx: -1, turno_desde: null, proximo_turno_at: null, updated_at: ahora },
      });
      if (r.count === 0) return false;
      eventos.push({
        tipo: 'pausada',
        ronda: m.ronda,
        id_user: origen.idUser ?? null,
        detalle:
          d.motivo === 'sin_aporte'
            ? 'Nadie aportó algo nuevo en una ronda completa: la mesa se pausó sola. Reanúdela o agregue una pregunta.'
            : 'Pausada por una persona.',
      });
    }

    if (eventos.length > 0) {
      await tx.chatProjectMesaEvento.createMany({
        data: eventos.map((e) => ({ id_mesa: m.id_mesa, created_at: ahora, ...e })),
      });
    }
    return true;
  });
}

/* ───────────────────────────── Motor ───────────────────────────── */

const TICK_CADA_MS = 15_000;
let ultimoTick = 0;
let tickEnCurso: Promise<void> | null = null;

/**
 * Avanza las mesas que lo necesiten. Barato y a prueba de errores: nunca lanza
 * (la bandeja que lo llama no debe caerse por una mesa).
 */
export function tickMesas(ahora: Date = new Date()): Promise<void> {
  if (tickEnCurso || ahora.getTime() - ultimoTick < TICK_CADA_MS) return tickEnCurso ?? Promise.resolve();
  ultimoTick = ahora.getTime();
  tickEnCurso = (async () => {
    try {
      const vencidoAntes = new Date(ahora.getTime() - MESA_TURNO_VENCE_MS);
      const pendientes = await prisma.chatProjectMesa.findMany({
        where: {
          estado: 'activa',
          conversation: { archived: false },
          project: { archived: false },
          OR: [
            { turno_idx: -1, proximo_turno_at: { lte: ahora } },
            { turno_idx: { gte: 0 }, turno_desde: { lte: vencidoAntes } },
          ],
        },
        take: 10,
        include: includeMesa,
      });
      for (const m of pendientes) {
        try {
          await aplicarDecision(m, decidirTick(aEstadoMotor(m), ahora), ahora);
        } catch (error) {
          console.error('[mesas] tick', m.id_mesa, error);
        }
      }
    } catch (error) {
      console.error('[mesas] tick', error);
    } finally {
      tickEnCurso = null;
    }
  })();
  return tickEnCurso;
}

/**
 * Un agente publicó en una conversación. Si es una mesa y era su turno, registra
 * la respuesta y entrega el turno siguiente. Devuelve si la conversación es una
 * mesa (para no mandar push a los miembros en cada turno) y si fue la síntesis.
 */
export async function alPublicarAgenteEnMesa(opciones: {
  idConversation: number;
  idAgent: number;
  idMessage: number;
  body: string;
  ahora?: Date;
}): Promise<{ esMesa: boolean; esSintesis: boolean }> {
  const ahora = opciones.ahora ?? new Date();
  const m = await cargarMesa({ id_conversation: opciones.idConversation });
  if (!m) return { esMesa: false, esSintesis: false };
  const estado = aEstadoMotor(m);
  const esSintesis = m.turno_idx === m.agentes.length && opciones.idAgent === m.id_agent_moderador;
  const d = decidirTrasRespuesta(estado, opciones.idAgent, !esSinAporte(opciones.body), ahora);
  if (d.tipo === 'nada') return { esMesa: true, esSintesis: false };

  const aporte = !esSinAporte(opciones.body) && m.turno_idx < m.agentes.length;
  await prisma.chatProjectMesaEvento.create({
    data: {
      id_mesa: m.id_mesa,
      tipo: 'respuesta',
      ronda: m.ronda,
      id_agent: opciones.idAgent,
      id_message: opciones.idMessage,
      detalle: resumenParaOperador(opciones.body),
      created_at: ahora,
    },
  });
  if (aporte) {
    await prisma.chatProjectMesa.updateMany({
      where: { id_mesa: m.id_mesa, ronda: m.ronda, turno_idx: m.turno_idx },
      data: { aportes_ronda: { increment: 1 } },
    });
  }
  await aplicarDecision(m, d, ahora);
  return { esMesa: true, esSintesis };
}

/**
 * Para la BANDEJA: si el mensaje es un aviso de turno, el texto que recibe el
 * agente = aviso + instrucciones (que no quedan guardadas en el hilo).
 */
export async function cuerpoParaAgente(m: { id: number; id_conversation: number; event_type: string | null; body: string }): Promise<string> {
  if (m.event_type !== EVENT_TYPE_TURNO) return m.body;
  const mesa = await cargarMesa({ id_conversation: m.id_conversation });
  if (!mesa) return m.body;
  const esSintesis = mesa.id_message_turno === m.id && mesa.turno_idx === mesa.agentes.length;
  const idx = mesa.id_message_turno === m.id ? mesa.turno_idx : 0;
  const p = mesa.agentes[idx];
  return `${m.body}\n\n${instruccionesTurno({
    tema: mesa.tema,
    turno: {
      idAgent: esSintesis ? mesa.id_agent_moderador : p?.id_agent ?? mesa.id_agent_moderador,
      ronda: mesa.ronda,
      turnoIdx: idx,
      esSintesis,
      rol: esSintesis ? 'moderador: síntesis' : p?.rol ?? 'participa',
    },
    participantes: mesa.agentes.map((a) => ({ nombre: a.agent.display_name, rol: a.rol })),
  })}`;
}

/* ───────────────────────────── Acciones de personas ───────────────────────────── */

function exigirEscritura(project: ProjectAccess) {
  if (project.archived) throw new ProyectoError('El proyecto está archivado. Restáurelo para hacer cambios.', 403);
  if (!capabilitiesFor(project.role).write) throw new ProyectoError('Solo el dueño o un editor del proyecto pueden manejar las mesas.', 403);
}

/** Crea una mesa: una conversación del proyecto (principal = moderador) + reglas + participantes. */
export async function crearMesa(user: ProjectUser, project: ProjectAccess, entrada: Record<string, unknown>): Promise<{ idMesa: number; idConversation: number }> {
  exigirEscritura(project);
  const designados = (
    await prisma.chatProjectAgent.findMany({ where: { id_project: project.idProject }, select: { id_agent: true } })
  ).map((a) => a.id_agent);
  const v = validarMesa(
    {
      tema: entrada.tema,
      participantes: entrada.participantes,
      idAgentModerador: entrada.idAgentModerador,
      reglas: (entrada.reglas ?? {}) as Record<string, unknown>,
    },
    designados
  );
  if (!v.ok) throw new ProyectoError(v.error, 400);
  const mesa = v.value;

  // La persona debe poder escribirle a CADA agente de la mesa (la misma regla del chat).
  for (const p of mesa.participantes) {
    const permiso = await writeAccessForAgent(user, project, p.idAgent);
    if (!permiso.ok) throw new ProyectoError(permiso.motivo, 403);
  }
  const activas = await prisma.chatConversation.count({ where: { id_project: project.idProject, archived: false } });
  if (activas >= MAX_PROJECT_CONVERSATIONS) {
    throw new ProyectoError(`El proyecto ya tiene ${MAX_PROJECT_CONVERSATIONS} conversaciones activas.`, 409);
  }

  const agentes = await prisma.agent.findMany({
    where: { id_agent: { in: mesa.participantes.map((p) => p.idAgent) } },
    select: { id_agent: true, display_name: true },
  });
  const nombre = (id: number) => agentes.find((a) => a.id_agent === id)?.display_name ?? 'Asistente';
  const now = new Date();
  const titulo = `🗣️ Mesa: ${mesa.tema.replace(/\s+/g, ' ')}`.slice(0, Math.min(120, MAX_TITLE_CHARS));
  const quienes = mesa.participantes.map((p) => `**${nombre(p.idAgent)}** (${p.rol})`).join(', ');
  const r = mesa.reglas;
  const hh = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  const creada = await prisma.$transaction(async (tx) => {
    const c = await tx.chatConversation.create({
      data: {
        kind: 'project',
        id_project: project.idProject,
        title: titulo,
        id_company: project.idCompany,
        id_user: user.id,
        created_by: user.id,
        id_agent: mesa.idAgentModerador,
        last_message_at: now,
      },
      select: { id: true },
    });
    await tx.chatMessage.create({
      data: {
        id_conversation: c.id,
        role: 'system',
        body: [
          `🗣️ **Mesa de discusión** del proyecto **${project.name}**.`,
          `**Tema:** ${mesa.tema}`,
          `**Participan:** ${quienes}. Modera **${nombre(mesa.idAgentModerador)}**.`,
          `Una ronda cada ${r.ritmoMin} min, de ${hh(r.horarioDesde)} a ${hh(r.horarioHasta)}${r.soloHabiles ? ' en días hábiles' : ''}; máximo ${r.topeDia} turnos al día; síntesis cada ${r.sintesisCada} rondas.`,
          'Los agentes solo discuten y proponen. Cualquiera del proyecto puede escribir aquí: lo leen en su siguiente turno.',
        ].join('\n'),
        created_at: now,
        delivered_at: now,
      },
    });
    const m = await tx.chatProjectMesa.create({
      data: {
        id_project: project.idProject,
        id_conversation: c.id,
        tema: mesa.tema,
        id_agent_moderador: mesa.idAgentModerador,
        ritmo_min: r.ritmoMin,
        tope_dia: r.topeDia,
        sintesis_cada: r.sintesisCada,
        horario_desde: r.horarioDesde,
        horario_hasta: r.horarioHasta,
        solo_habiles: r.soloHabiles,
        proximo_turno_at: now,
        created_by: user.id,
        created_at: now,
        updated_at: now,
        agentes: { create: mesa.participantes.map((p, i) => ({ id_agent: p.idAgent, rol: p.rol, orden: i })) },
      },
      select: { id_mesa: true },
    });
    await tx.chatProjectMesaEvento.create({
      data: { id_mesa: m.id_mesa, tipo: 'creada', id_user: user.id, detalle: mesa.tema.slice(0, 1000), created_at: now },
    });
    await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: now } });
    return { idMesa: m.id_mesa, idConversation: c.id };
  });

  // Primera ronda de una vez si está dentro del horario.
  const m = await cargarMesa({ id_mesa: creada.idMesa });
  if (m) await aplicarDecision(m, decidirTick(aEstadoMotor(m), now), now);
  return creada;
}

async function mesaDelProyecto(project: ProjectAccess, idMesa: number): Promise<MesaFila> {
  const m = await cargarMesa({ id_mesa: idMesa });
  if (!m || m.id_project !== project.idProject) throw new ProyectoError('Mesa no encontrada.', 404);
  return m;
}

export type AccionMesa = 'pausar' | 'reanudar' | 'cerrar' | 'ronda_ahora';

export async function accionMesa(user: ProjectUser, project: ProjectAccess, idMesa: number, accion: unknown): Promise<{ ok: true }> {
  exigirEscritura(project);
  const m = await mesaDelProyecto(project, idMesa);
  const ahora = new Date();
  if (m.estado === 'cerrada') throw new ProyectoError('La mesa está cerrada.', 409);

  const evento = (tipo: string, detalle: string) =>
    prisma.chatProjectMesaEvento.create({ data: { id_mesa: m.id_mesa, tipo, id_user: user.id, ronda: m.ronda, detalle, created_at: ahora } });

  switch (accion) {
    case 'pausar': {
      if (m.estado !== 'activa') throw new ProyectoError('La mesa no está activa.', 409);
      const motivo: MotivoPausa = 'manual';
      await prisma.chatProjectMesa.update({
        where: { id_mesa: m.id_mesa },
        data: { estado: 'pausada', motivo_pausa: motivo, turno_idx: -1, turno_desde: null, proximo_turno_at: null, updated_at: ahora },
      });
      await evento('pausada', 'Pausada por una persona.');
      return { ok: true };
    }
    case 'reanudar': {
      if (m.estado !== 'pausada') throw new ProyectoError('La mesa no está pausada.', 409);
      await prisma.chatProjectMesa.update({
        where: { id_mesa: m.id_mesa },
        data: { estado: 'activa', motivo_pausa: null, turno_idx: -1, turno_desde: null, proximo_turno_at: ahora, updated_at: ahora },
      });
      await evento('reanudada', 'Reanudada por una persona.');
      const r = await cargarMesa({ id_mesa: m.id_mesa });
      if (r) await aplicarDecision(r, decidirTick(aEstadoMotor(r), ahora), ahora);
      return { ok: true };
    }
    case 'cerrar': {
      await prisma.chatProjectMesa.update({
        where: { id_mesa: m.id_mesa },
        data: { estado: 'cerrada', motivo_pausa: null, turno_idx: -1, turno_desde: null, proximo_turno_at: null, updated_at: ahora },
      });
      await evento('cerrada', 'Cerrada por una persona. La conversación queda para consulta.');
      return { ok: true };
    }
    case 'ronda_ahora': {
      if (m.estado !== 'activa') throw new ProyectoError('Reanude la mesa primero.', 409);
      if (m.turno_idx >= 0) throw new ProyectoError('Ya hay un turno en curso.', 409);
      await evento('ronda_ahora', 'Una persona pidió la siguiente ronda de inmediato.');
      await aplicarDecision(m, decidirTick(aEstadoMotor(m), ahora, { forzar: true }), ahora);
      return { ok: true };
    }
    default:
      throw new ProyectoError('Acción no válida.', 400);
  }
}

/** Lo que ve el operador: lista de mesas del proyecto. */
export async function listarMesas(project: ProjectAccess) {
  const mesas = await prisma.chatProjectMesa.findMany({
    where: { id_project: project.idProject, conversation: { archived: false } },
    orderBy: { id_mesa: 'desc' },
    include: includeMesa,
  });
  return mesas.map((m) => serializarMesa(m));
}

function serializarMesa(m: MesaFila) {
  const deTurno =
    m.turno_idx < 0 ? null : m.turno_idx === m.agentes.length ? m.id_agent_moderador : m.agentes[m.turno_idx]?.id_agent ?? null;
  return {
    idMesa: m.id_mesa,
    idConversation: m.id_conversation,
    tema: m.tema,
    estado: m.estado,
    motivoPausa: m.motivo_pausa,
    ronda: m.ronda,
    esSintesis: m.turno_idx >= 0 && m.turno_idx === m.agentes.length,
    idAgentDeTurno: deTurno,
    turnoDesde: m.turno_desde?.toISOString() ?? null,
    proximoTurnoAt: m.proximo_turno_at?.toISOString() ?? null,
    turnosHoy: m.turnos_dia === diaCOT(new Date()) ? m.turnos_hoy : 0,
    reglas: {
      ritmoMin: m.ritmo_min,
      topeDia: m.tope_dia,
      sintesisCada: m.sintesis_cada,
      horarioDesde: m.horario_desde,
      horarioHasta: m.horario_hasta,
      soloHabiles: m.solo_habiles,
    },
    idAgentModerador: m.id_agent_moderador,
    participantes: m.agentes.map((a) => ({ idAgent: a.id_agent, code: a.agent.code, nombre: a.agent.display_name, rol: a.rol })),
    createdAt: m.created_at.toISOString(),
  };
}

/** Detalle de una mesa con su registro de eventos (lo más reciente primero). */
export async function detalleMesa(project: ProjectAccess, idMesa: number) {
  const m = await mesaDelProyecto(project, idMesa);
  const eventos = await prisma.chatProjectMesaEvento.findMany({
    where: { id_mesa: m.id_mesa },
    orderBy: { id_evento: 'desc' },
    take: 80,
  });
  const estados = await prisma.chatAgentStatus.findMany({
    where: { id_conversation: m.id_conversation },
    select: { id_agent: true, state: true, label: true, updated_at: true },
  });
  return {
    ...serializarMesa(m),
    estadosAgentes: estados.map((e) => ({ idAgent: e.id_agent, state: e.state, label: e.label, updatedAt: e.updated_at.toISOString() })),
    eventos: eventos.map((e) => ({
      id: e.id_evento,
      tipo: e.tipo,
      ronda: e.ronda,
      idAgent: e.id_agent,
      idMessage: e.id_message,
      detalle: e.detalle,
      createdAt: e.created_at.toISOString(),
    })),
  };
}
