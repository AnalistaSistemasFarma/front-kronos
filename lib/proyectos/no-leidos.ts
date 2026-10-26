/**
 * MENSAJES NO LEÍDOS de las conversaciones de PROYECTO, por persona — el icono
 * «Proyectos» de la cabecera (pedido de Nicolás Rivera del 2026-10-19: «quiero
 * que en el header también tenga su iconito y si alguien escribe en alguno de
 * los chats se pueda ver»).
 *
 * -------------------------------------------------------------------------
 * EL MODELO DE LECTURA
 * -------------------------------------------------------------------------
 * El mismo del chat en grupos y entre personas: una MARCA DE AGUA por persona y
 * conversación (el id del último mensaje que ya vio), que solo avanza. Vive en
 * chat_project_read y no en chat_participant porque los miembros de un proyecto
 * no son participantes del chat (ver el modelo en prisma/schema.prisma).
 *
 * Cuenta como NUEVO todo mensaje de una persona o de un agente posterior a la
 * marca y que no escribió la propia persona. Los de sistema no cuentan.
 *
 * -------------------------------------------------------------------------
 * LA PUERTA (la misma de resolveProjectForUser, en una sola consulta)
 * -------------------------------------------------------------------------
 * Solo entran conversaciones 'project', no archivadas, de proyectos NO
 * archivados, donde la persona es MIEMBRO (dueño, editor o lector) y conserva el
 * permiso del módulo «Proyectos» en la empresa del proyecto. Un lector ve sus no
 * leídos (leer es lo que su rol permite); quien no es miembro no ve nada — ni el
 * número, ni el nombre, ni el fragmento. lib/proyectos/__tests__/no-leidos.test.ts
 * fija que el filtro no se afloje.
 */
import { prisma } from '../prisma';
import { projectModuleCompanies, type ProjectUser } from '../chat/projects';
import { toPlainPreview } from '../chat/client';
import type { EstadoAgenteProyectoDto } from './estado-agente';

/** Conversaciones (las más recientes) que se revisan por consulta. Acota el costo. */
export const MAX_CONVERSACIONES_REVISADAS = 300;
/** Filas del panel desplegable. */
export const MAX_ITEMS_PANEL = 30;
/** Largo del fragmento del último mensaje que viaja al panel. */
export const FRAGMENTO_CHARS = 120;
/** Roles que cuentan como mensaje nuevo: personas y agentes (no los de sistema). */
export const ROLES_QUE_CUENTAN = ['user', 'agent'] as const;

/** Filtro Prisma de las conversaciones de proyecto que ESTA persona puede leer hoy. */
export function whereConversacionesVisibles(userId: string, empresas: number[]) {
  return {
    kind: 'project',
    archived: false,
    project: {
      archived: false,
      id_company: { in: empresas },
      members: { some: { id_user: userId } },
    },
  };
}

/** Filtro Prisma de los mensajes que cuentan como nuevos para esta persona. */
export function whereMensajesQueCuentan(userId: string) {
  return {
    role: { in: [...ROLES_QUE_CUENTAN] },
    // Explícito: los del agente tienen id_user_author NULL y sí cuentan.
    OR: [{ id_user_author: null }, { id_user_author: { not: userId } }],
  };
}

/** Fragmento de una línea, en texto plano (nunca HTML), para el panel. */
export function fragmentoMensaje(body: string | null | undefined, max = FRAGMENTO_CHARS): string {
  const plano = toPlainPreview(body ?? '');
  if (!plano) return 'Envió un archivo';
  return plano.length <= max ? plano : `${plano.slice(0, max - 1).trimEnd()}…`;
}

export interface ItemNoLeido {
  idProject: number;
  projectName: string;
  idConversation: number;
  conversationTitle: string;
  agent: { code: string; displayName: string };
  /** Mensajes nuevos en esta conversación. */
  noLeidos: number;
  ultimo: {
    idMessage: number;
    autor: string;
    autorTipo: 'persona' | 'agente';
    fragmento: string;
    createdAt: string;
  } | null;
}

export interface ResumenNoLeidos {
  /** Conversaciones con al menos un mensaje nuevo (el número del icono). */
  noLeidos: number;
  /** Total de mensajes nuevos (para la etiqueta accesible). */
  mensajes: number;
  items?: ItemNoLeido[];
  /** Agentes trabajando ahora en conversaciones visibles (2026-10-20; la ruta lo completa). */
  trabajando?: EstadoAgenteProyectoDto[];
}

type ConversacionVisible = {
  id: number;
  title: string | null;
  id_project: number | null;
  project: { name: string } | null;
  agent: { code: string; display_name: string };
};

/** Conversaciones visibles con mensajes nuevos: id → { cuántos, último id }. En el orden de actividad. */
async function contar(user: ProjectUser): Promise<{ convs: ConversacionVisible[]; nuevos: Map<number, { n: number; ultimo: number }> } | null> {
  const empresas = await projectModuleCompanies(user.id);
  if (empresas.length === 0) return null;

  const convs = await prisma.chatConversation.findMany({
    where: { ...whereConversacionesVisibles(user.id, empresas.map((e) => e.idCompany)), last_message_at: { not: null } },
    orderBy: { last_message_at: 'desc' },
    take: MAX_CONVERSACIONES_REVISADAS,
    select: {
      id: true,
      title: true,
      id_project: true,
      project: { select: { name: true } },
      agent: { select: { code: true, display_name: true } },
    },
  });
  const nuevos = new Map<number, { n: number; ultimo: number }>();
  if (convs.length === 0) return { convs, nuevos };

  const ids = convs.map((c) => c.id);
  const lecturas = await prisma.chatProjectRead.findMany({
    where: { id_user: user.id, id_conversation: { in: ids } },
    select: { id_conversation: true, last_read_message_id: true },
  });
  const marca = new Map(lecturas.map((l) => [l.id_conversation, l.last_read_message_id]));

  const grupos = await prisma.chatMessage.groupBy({
    by: ['id_conversation'],
    where: {
      AND: [
        { OR: convs.map((c) => ({ id_conversation: c.id, id: { gt: marca.get(c.id) ?? 0 } })) },
        whereMensajesQueCuentan(user.id),
      ],
    },
    _count: { _all: true },
    _max: { id: true },
  });
  const visibles = new Set(ids);
  for (const g of grupos) {
    // Defensa: solo conversaciones que pasaron la puerta.
    if (!visibles.has(g.id_conversation)) continue;
    const n = g._count._all;
    if (n > 0) nuevos.set(g.id_conversation, { n, ultimo: g._max.id ?? 0 });
  }
  return { convs, nuevos };
}

/**
 * Resumen de no leídos de la persona. `null` = no tiene el módulo «Proyectos»
 * en ninguna empresa (la ruta responde 403 y el icono no se pinta).
 */
export async function resumenNoLeidos(user: ProjectUser, opciones: { detalle: boolean }): Promise<ResumenNoLeidos | null> {
  const r = await contar(user);
  if (!r) return null;
  const { convs, nuevos } = r;

  let mensajes = 0;
  for (const v of nuevos.values()) mensajes += v.n;
  const resumen: ResumenNoLeidos = { noLeidos: nuevos.size, mensajes };
  if (!opciones.detalle) return resumen;

  const conNuevos = convs.filter((c) => nuevos.has(c.id) && c.id_project !== null).slice(0, MAX_ITEMS_PANEL);
  const ultimos = conNuevos.map((c) => nuevos.get(c.id)!.ultimo).filter((id) => id > 0);
  const filas = ultimos.length
    ? await prisma.chatMessage.findMany({
        // Anclado también a las conversaciones visibles: un id suelto no trae nada ajeno.
        where: { id: { in: ultimos }, id_conversation: { in: conNuevos.map((c) => c.id) } },
        select: {
          id: true,
          id_conversation: true,
          body: true,
          role: true,
          created_at: true,
          userAuthor: { select: { name: true, email: true } },
          agentAuthor: { select: { display_name: true } },
        },
      })
    : [];
  const porConversacion = new Map(filas.map((f) => [f.id_conversation, f]));

  resumen.items = conNuevos.map((c) => {
    const f = porConversacion.get(c.id);
    const esAgente = f?.role === 'agent';
    return {
      idProject: c.id_project!,
      projectName: c.project?.name ?? 'Proyecto',
      idConversation: c.id,
      conversationTitle: c.title?.trim() || 'Conversación',
      agent: { code: c.agent.code, displayName: c.agent.display_name },
      noLeidos: nuevos.get(c.id)!.n,
      ultimo: f
        ? {
            idMessage: f.id,
            autor: esAgente
              ? f.agentAuthor?.display_name?.trim() || c.agent.display_name
              : f.userAuthor?.name?.trim() || f.userAuthor?.email || 'Alguien',
            autorTipo: esAgente ? 'agente' : 'persona',
            fragmento: fragmentoMensaje(f.body),
            createdAt: f.created_at.toISOString(),
          }
        : null,
    };
  });
  return resumen;
}

/** Mensajes nuevos de UNA conversación para esta persona, desde una marca. */
async function contarDesde(userId: string, conversationId: number, marca: number): Promise<number> {
  return prisma.chatMessage.count({
    where: { id_conversation: conversationId, id: { gt: marca }, ...whereMensajesQueCuentan(userId) },
  });
}

function esDuplicado(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/**
 * Marca una conversación de proyecto como leída hasta `upTo` (o hasta el último
 * mensaje). La puerta ya la pasó quien llama (guardConversation). La marca solo
 * avanza y nunca pasa del último mensaje real de la conversación: un número
 * inventado por el cliente no deja «leído» lo que todavía no existe.
 */
export async function marcarLeidaProyecto(
  userId: string,
  conversationId: number,
  upTo?: number
): Promise<{ marca: number; unreadCount: number; updated: number }> {
  const ultimo = await prisma.chatMessage.findFirst({
    where: { id_conversation: conversationId },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  const tope = ultimo?.id ?? 0;
  const hasta = Math.min(upTo ?? tope, tope);

  const actual = await prisma.chatProjectRead.findUnique({
    where: { id_conversation_id_user: { id_conversation: conversationId, id_user: userId } },
    select: { last_read_message_id: true },
  });

  let updated = 0;
  if (!actual) {
    try {
      await prisma.chatProjectRead.create({
        data: { id_conversation: conversationId, id_user: userId, last_read_message_id: hasta },
      });
      updated = hasta > 0 ? 1 : 0;
    } catch (error) {
      // Otra pestaña la creó al mismo tiempo: se sigue por el camino del UPDATE.
      if (!esDuplicado(error)) throw error;
    }
  }
  if (updated === 0 && hasta > (actual?.last_read_message_id ?? 0)) {
    // UPDATE atómico que solo avanza: dos pestañas no pueden «desleer».
    const r = await prisma.chatProjectRead.updateMany({
      where: { id_conversation: conversationId, id_user: userId, last_read_message_id: { lt: hasta } },
      data: { last_read_message_id: hasta, updated_at: new Date() },
    });
    updated = r.count;
  }

  const final = await prisma.chatProjectRead.findUnique({
    where: { id_conversation_id_user: { id_conversation: conversationId, id_user: userId } },
    select: { last_read_message_id: true },
  });
  const marca = final?.last_read_message_id ?? hasta;
  return { marca, unreadCount: await contarDesde(userId, conversationId, marca), updated };
}

/** «Marcar todo como leído» del panel: solo lo que la persona puede ver hoy. */
export async function marcarTodoLeido(user: ProjectUser): Promise<{ conversaciones: number } | null> {
  const r = await contar(user);
  if (!r) return null;
  let conversaciones = 0;
  for (const [idConversation, { ultimo }] of r.nuevos) {
    const x = await marcarLeidaProyecto(user.id, idConversation, ultimo);
    if (x.updated > 0) conversaciones++;
  }
  return { conversaciones };
}
