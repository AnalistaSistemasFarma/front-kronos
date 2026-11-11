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
import { assertAgentProjectConversation, designableAgents, type ProjectAccess, type ProjectUser } from '../chat/projects';
import { serializeAttachment, type ChatAttachmentPayload } from '../chat/conversations';
import { politicaGuardadaConCodigo } from './permisos-agentes';
import { mensajeSoloDesarrollo } from './agentes-desarrollo-rules';
import { ProyectoError } from './acciones';
import {
  archivosParaAgente,
  detalleArchivoCompartido,
  esParticipanteMesa,
  decidirTick,
  decidirTrasRespuesta,
  diaCOT,
  esSinAporte,
  instruccionesTurno,
  resumenParaOperador,
  textoAvisoTurno,
  textoVisibleSinAporte,
  validarMesa,
  MESA_TURNO_VENCE_MS,
  type Decision,
  type EstadoMotor,
  type EstadoMesa,
  type MotivoPausa,
  type ArchivoMesa,
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
  /** Nombres de los archivos que el agente adjuntó a su intervención. */
  adjuntos?: string[];
  ahora?: Date;
}): Promise<{ esMesa: boolean; esSintesis: boolean }> {
  const ahora = opciones.ahora ?? new Date();
  const m = await cargarMesa({ id_conversation: opciones.idConversation });
  if (!m) return { esMesa: false, esSintesis: false };
  await registrarArchivosCompartidos(m, opciones.idAgent, opciones.idMessage, opciones.adjuntos ?? [], ahora);
  const estado = aEstadoMotor(m);
  const esSintesis = m.turno_idx === m.agentes.length && opciones.idAgent === m.id_agent_moderador;
  const d = decidirTrasRespuesta(estado, opciones.idAgent, !esSinAporte(opciones.body), ahora);
  if (d.tipo === 'nada') return { esMesa: true, esSintesis: false };

  const sinAporte = esSinAporte(opciones.body);
  const aporte = !sinAporte && m.turno_idx < m.agentes.length;
  // La marca interna no se deja ver: en el hilo queda como lo diría una persona.
  if (sinAporte) {
    await prisma.chatMessage.update({ where: { id: opciones.idMessage }, data: { body: textoVisibleSinAporte(opciones.body) } });
  }
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

/* ───────────────────────── Archivos compartidos ───────────────────────── */

function idsDeLaMesa(m: MesaFila): { participantes: number[]; idAgentModerador: number } {
  return { participantes: m.agentes.map((a) => a.id_agent), idAgentModerador: m.id_agent_moderador };
}

/**
 * «El moderador informa qué archivos se están pasando» (2026-11-11): un evento
 * INMUTABLE `archivo_compartido` por archivo, con nombre, agente y ronda. Solo
 * de agentes de la mesa. Nunca tumba la publicación (si la base todavía no
 * admite el tipo, queda en el log y el archivo igual está en el hilo).
 */
async function registrarArchivosCompartidos(m: MesaFila, idAgent: number, idMessage: number, nombres: string[], ahora: Date) {
  if (nombres.length === 0 || !esParticipanteMesa(idsDeLaMesa(m), idAgent)) return;
  const agente = nombreAgente(m, idAgent).nombre;
  const ronda = m.ronda > 0 ? m.ronda : null;
  try {
    await prisma.chatProjectMesaEvento.createMany({
      data: nombres.map((nombre) => ({
        id_mesa: m.id_mesa,
        tipo: EVENTO_ARCHIVO_COMPARTIDO,
        ronda,
        id_agent: idAgent,
        id_message: idMessage,
        detalle: detalleArchivoCompartido(nombre, agente, ronda),
        created_at: ahora,
      })),
    });
  } catch (error) {
    console.error('[mesas] no se pudo registrar el archivo compartido', m.id_mesa, error);
  }
}

export const EVENTO_ARCHIVO_COMPARTIDO = 'archivo_compartido';

/**
 * Los archivos que compartieron los agentes de la mesa, en orden de llegada.
 * Salen de los ADJUNTOS de la conversación de ESTA mesa (nunca de otra), de
 * mensajes de agentes de la mesa; la ronda, del evento `archivo_compartido`.
 */
async function archivosDeMesa(m: MesaFila): Promise<(ArchivoMesa & { adjunto: ChatAttachmentPayload; createdAt: string })[]> {
  const ids = idsDeLaMesa(m);
  const [adjuntos, eventos] = await Promise.all([
    prisma.chatAttachment.findMany({
      where: {
        message: {
          id_conversation: m.id_conversation,
          role: 'agent',
          id_agent_author: { in: [...ids.participantes, ids.idAgentModerador] },
        },
      },
      orderBy: { id: 'desc' },
      take: 100,
      select: {
        id: true,
        file_name: true,
        content_type: true,
        size_bytes: true,
        created_at: true,
        message: { select: { id: true, id_agent_author: true } },
      },
    }),
    prisma.chatProjectMesaEvento.findMany({
      where: { id_mesa: m.id_mesa, tipo: EVENTO_ARCHIVO_COMPARTIDO },
      select: { id_message: true, ronda: true },
    }),
  ]);
  const rondaDe = new Map(eventos.filter((e) => e.id_message !== null).map((e) => [e.id_message as number, e.ronda]));
  return adjuntos.reverse().map((a) => {
    const idAgent = a.message.id_agent_author ?? 0;
    return {
      idAttachment: a.id,
      nombre: a.file_name,
      idAgent,
      agente: nombreAgente(m, idAgent).nombre,
      ronda: rondaDe.get(a.message.id) ?? null,
      adjunto: serializeAttachment(a),
      createdAt: a.created_at.toISOString(),
    };
  });
}

/**
 * Para la DESCARGA de un adjunto (/api/chat/attachments/<id>) con la llave del
 * puente: un agente que NO es el principal del hilo puede bajar los adjuntos de
 * una MESA solo si es participante de esa mesa y sigue designado en el proyecto
 * activo (la misma puerta de su contexto). Fuera de las mesas, nada cambia.
 */
export async function agentePuedeBajarAdjuntoDeMesa(idAgent: number, idConversation: number): Promise<boolean> {
  const m = await cargarMesa({ id_conversation: idConversation });
  if (!m || !esParticipanteMesa(idsDeLaMesa(m), idAgent)) return false;
  return (await assertAgentProjectConversation(idAgent, idConversation)) !== null;
}

/**
 * Para la BANDEJA: si el mensaje es un aviso de turno, lo que recibe el agente
 * = aviso + instrucciones (que no quedan guardadas en el hilo) y, como
 * adjuntos, los archivos que compartieron los agentes de la mesa.
 */
export async function turnoParaAgente(
  m: { id: number; id_conversation: number; event_type: string | null; body: string },
  idAgent: number
): Promise<{ body: string; adjuntos: ChatAttachmentPayload[] } | null> {
  if (m.event_type !== EVENT_TYPE_TURNO) return null;
  const mesa = await cargarMesa({ id_conversation: m.id_conversation });
  if (!mesa) return null;
  const todos = await archivosDeMesa(mesa);
  const visibles = archivosParaAgente({ archivos: todos, ...idsDeLaMesa(mesa), idAgent });
  const porId = new Map(todos.map((a) => [a.idAttachment, a.adjunto]));
  return {
    body: cuerpoTurno(mesa, m, visibles),
    adjuntos: visibles.map((a) => porId.get(a.idAttachment)!).filter(Boolean),
  };
}

function cuerpoTurno(mesa: MesaFila, m: { id: number; body: string }, archivos: ArchivoMesa[]): string {
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
    archivos: archivos.map(({ idAttachment, nombre, idAgent, agente, ronda }) => ({ idAttachment, nombre, idAgent, agente, ronda })),
    sintesisCada: mesa.sintesis_cada,
  })}`;
}

/* ───────────────────────────── Acciones de personas ───────────────────────────── */

function exigirEscritura(project: ProjectAccess) {
  if (project.archived) throw new ProyectoError('El proyecto está archivado. Restáurelo para hacer cambios.', 403);
  if (!capabilitiesFor(project.role).write) throw new ProyectoError('Solo el dueño o un editor del proyecto pueden manejar las mesas.', 403);
}

/** Crea una mesa: una conversación del proyecto (principal = moderador) + reglas + participantes. */
/** Agente que la persona puede poner en una mesa de este proyecto. */
export interface CandidatoMesa {
  idAgent: number;
  code: string;
  nombre: string;
  avatarUrl: string | null;
  avatarVersion: number | null;
  /** Ya está designado en el proyecto. */
  designado: boolean;
  /** Tiene el perfil de conectores del proyecto; si no, en la mesa entra SIN conectores. */
  conConectores: boolean;
  esDesarrollo: boolean;
}

/**
 * Agentes que ESTA persona puede poner en una mesa (2026-11-05, Nicolás Rivera:
 * «que pueda elegir todos los agentes que quiera»): todos los que tiene asignados
 * en la empresa del proyecto y con Proyectos habilitado (con CUALQUIER perfil:
 * quien no tiene el del proyecto entra a la mesa sin conectores).
 */
export async function candidatosMesa(user: ProjectUser, project: ProjectAccess): Promise<CandidatoMesa[]> {
  const [porEmpresa, actuales] = await Promise.all([
    designableAgents(user.email),
    prisma.chatProjectAgent.findMany({ where: { id_project: project.idProject }, select: { id_agent: true } }),
  ]);
  const ya = new Set(actuales.map((a) => a.id_agent));
  return (porEmpresa.get(project.idCompany) ?? [])
    .map((a) => ({
      idAgent: a.idAgent,
      code: a.code,
      nombre: a.displayName,
      avatarUrl: a.avatarUrl,
      avatarVersion: a.avatarVersion,
      designado: ya.has(a.idAgent),
      conConectores: a.profiles.includes(project.profile),
      esDesarrollo: a.esDesarrollo,
    }))
    .sort((x, y) => Number(y.designado) - Number(x.designado) || x.nombre.localeCompare(y.nombre, 'es'));
}

/** Crea una mesa: una conversación del proyecto (principal = moderador) + reglas + participantes. */
export async function crearMesa(user: ProjectUser, project: ProjectAccess, entrada: Record<string, unknown>): Promise<{ idMesa: number; idConversation: number }> {
  exigirEscritura(project);
  const candidatos = await candidatosMesa(user, project);
  const v = validarMesa(
    {
      tema: entrada.tema,
      participantes: entrada.participantes,
      idAgentModerador: entrada.idAgentModerador,
      reglas: (entrada.reglas ?? {}) as Record<string, unknown>,
    },
    candidatos.map((c) => c.idAgent)
  );
  if (!v.ok) throw new ProyectoError(v.error, 400);
  const mesa = v.value;

  // Los que no están en el proyecto se designan al crear la mesa: solo el dueño
  // (la misma regla de «Agregar asistentes»), y en un proyecto con acceso a
  // código, solo agentes de desarrollo (regla del 2026-10-27).
  const nuevos = mesa.participantes
    .map((p) => candidatos.find((c) => c.idAgent === p.idAgent)!)
    .filter((c) => !c.designado);
  if (nuevos.length > 0) {
    if (!capabilitiesFor(project.role).manageAgents) {
      throw new ProyectoError('Solo el dueño del proyecto puede sumar a la mesa agentes que todavía no están en el proyecto.', 403);
    }
    const negocio = nuevos.filter((c) => !c.esDesarrollo);
    if (negocio.length > 0 && (await politicaGuardadaConCodigo(project.idProject))) {
      throw new ProyectoError(
        `${mensajeSoloDesarrollo(negocio.map((c) => c.nombre))} Para agregarlo, primero deje los permisos del proyecto en «Ninguno».`,
        400
      );
    }
  }
  const activas = await prisma.chatConversation.count({ where: { id_project: project.idProject, archived: false } });
  if (activas >= MAX_PROJECT_CONVERSATIONS) {
    throw new ProyectoError(`El proyecto ya tiene ${MAX_PROJECT_CONVERSATIONS} conversaciones activas.`, 409);
  }
  if (nuevos.length > 0) {
    await prisma.chatProjectAgent.createMany({
      data: nuevos.map((c) => ({ id_project: project.idProject, id_agent: c.idAgent, added_by: user.id })),
    });
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
  const archivos = await archivosDeMesa(m);
  return {
    ...serializarMesa(m),
    // «Archivos compartidos» del panel: lo más reciente primero.
    archivos: archivos.reverse().map((a) => ({
      idAttachment: a.idAttachment,
      nombre: a.nombre,
      idAgent: a.idAgent,
      agente: a.agente,
      ronda: a.ronda,
      downloadUrl: a.adjunto.downloadUrl,
      createdAt: a.createdAt,
    })),
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
