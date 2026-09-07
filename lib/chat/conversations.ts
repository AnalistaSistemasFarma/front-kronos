/**
 * Consulta y serialización de conversaciones y mensajes.
 *
 * Vive en `lib/` y no dentro de las rutas para que la bandeja y el "abrir
 * conversación" devuelvan EXACTAMENTE la misma forma: si cada endpoint arma su
 * propio objeto, el cliente termina con dos versiones del mismo dato.
 */
import { prisma } from '../prisma';
import { getChatAccess } from './access';
import { toPreview } from './constants';
import { parseAgentTasks } from './status-tasks';

export interface ChatMessagePayload {
  id: number;
  role: string;
  body: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  attachments: ChatAttachmentPayload[];
}

/**
 * Adjunto tal como lo ve el CLIENTE.
 *
 * A propósito NO viaja el `onedrive_item_id` ni el `web_url`: el primero es el
 * identificador interno del archivo en Graph y el segundo es un enlace de
 * OneDrive que se reenvía con un copiar y pegar. La única puerta al contenido
 * es `downloadUrl`, que pasa por /api/chat/attachments/[id] y vuelve a
 * comprobar el permiso en cada descarga.
 */
export interface ChatAttachmentPayload {
  id: number;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  downloadUrl: string;
}

export interface ChatConversationPayload {
  id: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  archived: boolean;
  agent: {
    idAgent: number;
    code: string;
    displayName: string;
    handle: string | null;
    avatarUrl: string | null;
  };
  lastMessage: { id: number; role: string; preview: string; createdAt: string } | null;
  unreadCount: number;
  agentStatus: { state: string; label: string | null; updatedAt: string } | null;
}

/** Forma mínima de una fila de chat_message con sus adjuntos. */
type MessageRow = {
  id: number;
  role: string;
  body: string;
  created_at: Date;
  delivered_at: Date | null;
  read_at: Date | null;
  attachments?: {
    id: number;
    file_name: string;
    content_type: string | null;
    size_bytes: number | null;
  }[];
};

export function serializeMessage(row: MessageRow): ChatMessagePayload {
  return {
    id: row.id,
    role: row.role,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    deliveredAt: row.delivered_at ? row.delivered_at.toISOString() : null,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    attachments: (row.attachments ?? []).map(serializeAttachment),
  };
}

/** Serializa UN adjunto. Un solo lugar para decidir qué sale hacia afuera. */
export function serializeAttachment(row: {
  id: number;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
}): ChatAttachmentPayload {
  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    downloadUrl: `/api/chat/attachments/${row.id}`,
  };
}

/** `include` que necesita `serializeConversation`. */
const conversationInclude = {
  agent: {
    select: {
      id_agent: true,
      code: true,
      display_name: true,
      handle: true,
      avatar_url: true,
    },
  },
  status: true,
  messages: {
    orderBy: { id: 'desc' as const },
    take: 1,
    select: { id: true, role: true, body: true, created_at: true },
  },
};

type ConversationRow = {
  id: number;
  title: string | null;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
  archived: boolean;
  agent: {
    id_agent: number;
    code: string;
    display_name: string;
    handle: string | null;
    avatar_url: string | null;
  };
  status: { state: string; label: string | null; tasks: string | null; updated_at: Date } | null;
  messages: { id: number; role: string; body: string; created_at: Date }[];
};

export function serializeConversation(
  row: ConversationRow,
  unreadCount: number
): ChatConversationPayload {
  const last = row.messages[0];
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null,
    archived: row.archived,
    agent: {
      idAgent: row.agent.id_agent,
      code: row.agent.code,
      displayName: row.agent.display_name,
      handle: row.agent.handle,
      avatarUrl: row.agent.avatar_url,
    },
    lastMessage: last
      ? {
          id: last.id,
          role: last.role,
          preview: toPreview(last.body),
          createdAt: last.created_at.toISOString(),
        }
      : null,
    unreadCount,
    agentStatus: row.status
      ? {
          state: row.status.state,
          label: row.status.label,
          tasks: parseAgentTasks(row.status.tasks),
          updatedAt: row.status.updated_at.toISOString(),
        }
      : null,
  };
}

/**
 * Bandeja del usuario.
 *
 * Solo devuelve conversaciones con agentes sobre los que el usuario TODAVÍA
 * tiene permiso: si le revocan el subproceso, los hilos viejos desaparecen de
 * la lista igual que desaparece el agente. El filtro por `id_user` es lo que
 * ata cada hilo a su dueño; el correo viene de la sesión.
 */
export async function listUserConversations(
  userId: string,
  userEmail: string,
  opts: { archived: boolean }
): Promise<ChatConversationPayload[]> {
  const access = await getChatAccess(userEmail);
  if (!access.canUseChat || access.agents.length === 0) return [];

  const allowedAgentIds = access.agents.map((a) => a.idAgent);

  const rows = await prisma.chatConversation.findMany({
    where: {
      id_user: userId,
      id_agent: { in: allowedAgentIds },
      archived: opts.archived,
    },
    include: conversationInclude,
    orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
  });

  if (rows.length === 0) return [];

  // Un solo groupBy para los no leídos de todas las conversaciones: no leídos =
  // mensajes del AGENTE que el usuario todavía no ha marcado como leídos.
  const unread = await prisma.chatMessage.groupBy({
    by: ['id_conversation'],
    where: {
      id_conversation: { in: rows.map((r) => r.id) },
      role: 'agent',
      read_at: null,
    },
    _count: { _all: true },
  });
  const unreadByConversation = new Map(unread.map((u) => [u.id_conversation, u._count._all]));

  return rows.map((row) => serializeConversation(row, unreadByConversation.get(row.id) ?? 0));
}

/** Carga UNA conversación ya serializada (después de validar la propiedad). */
export async function getConversationPayload(
  conversationId: number
): Promise<ChatConversationPayload | null> {
  const row = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  });
  if (!row) return null;

  const unreadCount = await prisma.chatMessage.count({
    where: { id_conversation: conversationId, role: 'agent', read_at: null },
  });

  return serializeConversation(row, unreadCount);
}
