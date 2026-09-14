/**
 * BUSCADOR DE MENSAJES del chat.
 *
 * Pedido de Nicolás (2026-09-09): "necesito el buscador de mensajes".
 *
 * Dos decisiones que conviene entender antes de tocar esto:
 *
 * 1. EL ALCANCE NO SE CALCULA AQUÍ. Se pide a `conversationScopeFor`, el mismo
 *    que usa la bandeja, y se aplica a través de la relación `conversation`.
 *    Un buscador que resolviera el permiso por su cuenta es justo la clase de
 *    cosa que, el día que alguien ajuste el permiso en un solo lado, empieza a
 *    devolver mensajes de conversaciones ajenas. Aquí no hay forma: si la
 *    conversación no está en el alcance, sus mensajes no existen.
 *
 * 2. BÚSQUEDA SIMPLE, A PROPÓSITO. Es un `LIKE '%texto%'` (el `contains` de
 *    Prisma), sin índice de texto completo. Con el volumen de hoy —unos miles
 *    de mensajes— sobra, y meter Full-Text Search de SQL Server obligaría a
 *    una migración y a mantener un catálogo. Cuando el volumen lo pida se
 *    cambia solo esta función; la firma no tiene que moverse.
 *    La comparación es insensible a mayúsculas por la colación de la base, no
 *    por nada que hagamos aquí.
 */
import { prisma } from '../prisma';
// El tipo y los topes viven en client.ts: los necesita también el navegador, y
// este módulo importa prisma, así que no puede entrar en un bundle de cliente.
import { MAX_SEARCH_HITS, MIN_SEARCH_CHARS, type ChatSearchHit } from './client';
import { conversationScopeFor } from './conversations';

/** Cuánto texto se muestra alrededor de la coincidencia. */
const CONTEXTO = 70;

/**
 * Aplana el Markdown a algo legible en una línea.
 *
 * No sanea nada —el extracto viaja como texto y la interfaz lo pinta como
 * texto—, solo quita el ruido que haría ilegible una línea: cercas de código,
 * saltos y espacios repetidos.
 */
function aPlano(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' [código] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [imagen] ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracto centrado en la primera coincidencia. Exportado para poder
 * probarlo: es la parte que se rompe en silencio.
 *
 * Se busca sobre el texto YA aplanado, no sobre el Markdown: si se cortara el
 * crudo, el extracto podría partir un enlace o una cerca de código por la
 * mitad y quedar ilegible.
 */
export function extractoDeBusqueda(body: string, termino: string): string {
  const plano = aPlano(body);
  const donde = plano.toLowerCase().indexOf(termino.toLowerCase());
  if (donde < 0) return plano.slice(0, CONTEXTO * 2);

  const desde = Math.max(0, donde - CONTEXTO);
  const hasta = Math.min(plano.length, donde + termino.length + CONTEXTO);
  return `${desde > 0 ? '…' : ''}${plano.slice(desde, hasta)}${hasta < plano.length ? '…' : ''}`;
}

/**
 * Busca en los mensajes que ESTE usuario puede ver.
 *
 * Devuelve lista vacía —nunca un error— cuando el término es demasiado corto o
 * la persona no tiene el módulo: para la interfaz es el mismo caso, "no hay
 * nada que mostrar", y no vale la pena distinguirlo con un código de estado.
 */
export async function searchUserMessages(
  userId: string,
  userEmail: string,
  termino: string,
  limite: number = MAX_SEARCH_HITS
): Promise<ChatSearchHit[]> {
  const q = termino.trim();
  if (q.length < MIN_SEARCH_CHARS) return [];

  const alcance = await conversationScopeFor(userId, userEmail);
  if (!alcance) return [];

  const rows = await prisma.chatMessage.findMany({
    where: {
      body: { contains: q },
      conversation: { OR: alcance },
    },
    select: {
      id: true,
      id_conversation: true,
      body: true,
      role: true,
      created_at: true,
      conversation: {
        select: {
          kind: true,
          title: true,
          agent: { select: { code: true, display_name: true } },
        },
      },
      userAuthor: { select: { name: true, email: true } },
      agentAuthor: { select: { display_name: true } },
    },
    // Lo más reciente primero: buscando en un chat, casi siempre se busca algo
    // que se dijo hace poco.
    orderBy: { id: 'desc' },
    take: Math.min(Math.max(limite, 1), MAX_SEARCH_HITS),
  });

  return rows.map((row) => {
    const esGrupo = row.conversation.kind === 'group';
    return {
      idMessage: row.id,
      idConversation: row.id_conversation,
      kind: esGrupo ? ('group' as const) : ('direct' as const),
      conversationTitle: esGrupo
        ? (row.conversation.title ?? 'Grupo')
        : (row.conversation.agent?.display_name ?? 'Asistente'),
      // En un grupo el `agent` de la conversación es el anfitrión y NO sirve
      // para abrir nada: el grupo se abre por su id.
      agentCode: esGrupo ? null : (row.conversation.agent?.code ?? null),
      author:
        row.userAuthor?.name?.trim() ||
        row.userAuthor?.email ||
        row.agentAuthor?.display_name ||
        (row.role === 'agent'
          ? (row.conversation.agent?.display_name ?? 'Asistente')
          : row.role === 'system'
            ? 'Sistema'
            : 'Usted'),
      snippet: extractoDeBusqueda(row.body, q),
      createdAt: row.created_at.toISOString(),
    };
  });
}
