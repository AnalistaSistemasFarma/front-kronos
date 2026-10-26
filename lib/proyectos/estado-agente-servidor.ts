/**
 * ESTADO EN VIVO DEL AGENTE en conversaciones de PROYECTO — lado del servidor
 * (pedido de Nicolás Rivera del 2026-10-20; la lógica de pintado está en
 * lib/proyectos/estado-agente.ts).
 *
 * Solo LEE chat_agent_status, la misma tabla que alimenta el indicador del
 * chat y que el puente de hilos ya escribe (POST /api/chat/agent/status). No
 * crea tablas, columnas, índices ni sondeos nuevos.
 *
 * LA PUERTA es la del icono de la cabecera y del pulso de proyectos
 * (whereConversacionesVisibles): conversación 'project' no archivada, de un
 * proyecto no archivado, donde la persona es MIEMBRO y conserva el módulo en
 * la empresa del proyecto. Quien no es miembro no ve el estado — ni el nombre
 * del agente, ni la etiqueta, ni los subagentes.
 *
 * Solo cuenta la fila del agente DUEÑO de la conversación (cada conversación
 * de proyecto es de un solo agente, chat_conversation.id_agent).
 */
import { prisma } from '../prisma';
import { parseAgentTasks } from '../chat/status-tasks';
import { whereConversacionesVisibles } from './no-leidos';
import { MAX_ESTADOS, type EstadoAgenteProyectoDto } from './estado-agente';

const seleccion = {
  id_conversation: true,
  id_agent: true,
  state: true,
  label: true,
  tasks: true,
  updated_at: true,
  conversation: {
    select: {
      id_agent: true,
      id_project: true,
      title: true,
      project: { select: { name: true } },
      agent: { select: { id_agent: true, code: true, display_name: true, avatar_url: true, avatar_updated_at: true } },
    },
  },
} as const;

type FilaEstado = {
  id_conversation: number;
  id_agent: number;
  state: string;
  label: string | null;
  tasks: string | null;
  updated_at: Date;
  conversation: {
    id_agent: number;
    id_project: number | null;
    title: string | null;
    project: { name: string } | null;
    agent: { id_agent: number; code: string; display_name: string; avatar_url: string | null; avatar_updated_at: Date | null };
  };
};

/** Fila de la base → DTO. Null si no es del agente dueño o no tiene proyecto (defensa). */
export function aEstadoDto(f: FilaEstado): EstadoAgenteProyectoDto | null {
  if (f.id_agent !== f.conversation.id_agent || f.conversation.id_project == null) return null;
  const a = f.conversation.agent;
  return {
    idConversation: f.id_conversation,
    idProject: f.conversation.id_project,
    projectName: f.conversation.project?.name ?? 'Proyecto',
    conversationTitle: f.conversation.title?.trim() || 'Conversación',
    agent: {
      idAgent: a.id_agent,
      code: a.code,
      displayName: a.display_name,
      avatarUrl: a.avatar_url,
      avatarVersion: a.avatar_updated_at ? a.avatar_updated_at.getTime() : null,
    },
    state: f.state,
    label: f.label,
    tasks: parseAgentTasks(f.tasks),
    updatedAt: f.updated_at.toISOString(),
  };
}

function aDtos(filas: FilaEstado[]): EstadoAgenteProyectoDto[] {
  const salida: EstadoAgenteProyectoDto[] = [];
  for (const f of filas) {
    const d = aEstadoDto(f);
    if (d) salida.push(d);
  }
  return salida;
}

/**
 * Agentes TRABAJANDO ahora en conversaciones de proyecto visibles para la
 * persona (estado distinto de reposo, o con subagentes anotados). Lo usan la
 * lista de proyectos y el icono de la cabecera al cargar; lo que cambie
 * después llega por el pulso.
 */
export async function estadosTrabajandoVisibles(
  userId: string,
  empresas: number[],
  opciones: { idProjects?: number[] } = {}
): Promise<EstadoAgenteProyectoDto[]> {
  if (empresas.length === 0) return [];
  if (opciones.idProjects && opciones.idProjects.length === 0) return [];
  const visibles = whereConversacionesVisibles(userId, empresas);
  const filas = (await prisma.chatAgentStatus.findMany({
    where: {
      OR: [{ state: { not: 'idle' } }, { tasks: { not: null } }],
      conversation: opciones.idProjects ? { ...visibles, id_project: { in: opciones.idProjects } } : visibles,
    },
    orderBy: { updated_at: 'desc' },
    take: MAX_ESTADOS,
    select: seleccion,
  })) as FilaEstado[];
  // Con subagentes vacíos ('[]') la fila no dice nada: se descarta aquí.
  return aDtos(filas).filter((e) => e.state !== 'idle' || e.tasks.length > 0);
}

/**
 * Estados que CAMBIARON después de `desde` en conversaciones visibles para la
 * persona (también los que volvieron a reposo: así la pantalla deja de decir
 * «trabajando»). Lo usa el pulso.
 */
export async function estadosCambiadosVisibles(userId: string, empresas: number[], desde: Date): Promise<EstadoAgenteProyectoDto[]> {
  if (empresas.length === 0) return [];
  const filas = (await prisma.chatAgentStatus.findMany({
    where: { updated_at: { gt: desde }, conversation: whereConversacionesVisibles(userId, empresas) },
    orderBy: { updated_at: 'asc' },
    take: MAX_ESTADOS,
    select: seleccion,
  })) as FilaEstado[];
  return aDtos(filas);
}

/* ─────────────── Marca global (una consulta por instancia y segundo) ─────────────── */

/** Cuánto vale en memoria la marca global antes de volver a la base. */
export const MARCA_ESTADOS_TTL_MS = 900;

let marcaCache: { valor: Date; en: number } | null = null;
let marcaEnVuelo: Promise<Date> | null = null;

/**
 * El cambio de estado MÁS RECIENTE en conversaciones de proyecto (de quien
 * sea). El pulso la compara con el cursor de cada persona y solo si avanzó
 * hace la consulta filtrada por la puerta. Se comparte entre TODAS las
 * peticiones de la instancia durante MARCA_ESTADOS_TTL_MS: con 50 personas
 * mirando, sigue siendo ~1 consulta por segundo por instancia de PM2.
 */
export async function marcaGlobalEstados(ahora = Date.now()): Promise<Date> {
  if (marcaCache && ahora - marcaCache.en < MARCA_ESTADOS_TTL_MS && ahora >= marcaCache.en) return marcaCache.valor;
  if (marcaEnVuelo) return marcaEnVuelo;
  marcaEnVuelo = (async () => {
    try {
      const r = await prisma.chatAgentStatus.aggregate({
        where: { conversation: { kind: 'project' } },
        _max: { updated_at: true },
      });
      const valor = r._max.updated_at ?? new Date(0);
      marcaCache = { valor, en: Date.now() };
      return valor;
    } finally {
      marcaEnVuelo = null;
    }
  })();
  return marcaEnVuelo;
}

/** Para pruebas. */
export function __reiniciarMarca(): void {
  marcaCache = null;
  marcaEnVuelo = null;
}
