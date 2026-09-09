/**
 * Consulta y serialización de conversaciones y mensajes.
 *
 * Vive en `lib/` y no dentro de las rutas para que la bandeja y el "abrir
 * conversación" devuelvan EXACTAMENTE la misma forma: si cada endpoint arma su
 * propio objeto, el cliente termina con dos versiones del mismo dato.
 *
 * Sirve para las DOS clases de conversación (ver ChatConversation.kind en
 * prisma/schema.prisma):
 *   - 'direct' — una persona con un agente. El hilo original.
 *   - 'group'  — varias personas y varios agentes.
 * La forma que sale hacia el cliente es la misma; lo que cambia es qué campos
 * vienen con valor (`participants` y `agentStatuses` solo tienen sentido en un
 * grupo; `agentStatus`, en un hilo directo).
 */
import type { Prisma } from '../../app/generated/prisma';
import { prisma } from '../prisma';
import { getChatAccess } from './access';
import { toPreview } from './constants';
import { parseAgentTasks, type AgentTaskDto } from './status-tasks';

/**
 * Quién escribió un mensaje.
 *
 * En un hilo directo el `role` alcanzaba ('user' = el dueño, 'agent' = el
 * agente del hilo). En un grupo hay que decir CUÁL persona y CUÁL agente, y el
 * cliente necesita el nombre y la foto para pintarlo. `null` en los mensajes
 * de sistema: no los escribió nadie.
 */
export interface ChatAuthorPayload {
  kind: 'user' | 'agent';
  /** Id del usuario (cuid) o del agente, según `kind`. */
  id: string | number;
  name: string;
  avatarUrl: string | null;
}

/**
 * El mensaje CITADO, tal como se pinta encima de la respuesta.
 *
 * Viaja recortado (`preview`) y con el nombre del autor ya resuelto: la
 * interfaz no tiene que volver a buscar nada, y un mensaje citado larguísimo
 * no se manda entero para pintar dos renglones.
 */
export interface ChatReplyToPayload {
  idMessage: number;
  author: string;
  preview: string;
}

export interface ChatMessagePayload {
  id: number;
  role: string;
  body: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  attachments: ChatAttachmentPayload[];
  author: ChatAuthorPayload | null;
  /** El mensaje al que responde, o null. */
  replyTo: ChatReplyToPayload | null;
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

/** Un integrante de un grupo, tal como lo ve el cliente. */
export interface ChatParticipantPayload {
  kind: 'user' | 'agent';
  id: string | number;
  name: string;
  avatarUrl: string | null;
  /** El `@handle` del agente; null en las personas. */
  handle: string | null;
  role: string;
}

/** Indicador de "qué está haciendo" de UN agente. */
export interface ChatAgentStatusPayload {
  idAgent: number;
  state: string;
  label: string | null;
  tasks?: AgentTaskDto[];
  updatedAt: string;
}

export interface ChatConversationPayload {
  id: number;
  title: string | null;
  /** 'direct' | 'group'. */
  kind: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  archived: boolean;
  /**
   * En un hilo directo, el agente del hilo. En un GRUPO, el agente ANFITRIÓN
   * (la cara del grupo en la bandeja); los demás vienen en `participants`.
   */
  agent: {
    idAgent: number;
    code: string;
    displayName: string;
    handle: string | null;
    avatarUrl: string | null;
  };
  /** Empresa del grupo. null en los hilos directos. */
  company: { idCompany: number; companyName: string } | null;
  /** Integrantes. null en los hilos directos (no aplica). */
  participants: ChatParticipantPayload[] | null;
  lastMessage: { id: number; role: string; preview: string; createdAt: string } | null;
  unreadCount: number;
  /**
   * Estado del agente en un hilo DIRECTO. null en los grupos: allí hay varios
   * agentes y el desglose va en `agentStatuses`.
   *
   * `tasks` va aquí porque la fila de la bandeja también carga los sub-agentes
   * en curso. Opcional a propósito: un estado viejo no la trae y la tabla no
   * se pinta.
   */
  agentStatus: {
    state: string;
    label: string | null;
    tasks?: AgentTaskDto[];
    updatedAt: string;
  } | null;
  /** Un estado POR AGENTE. En un hilo directo trae, como máximo, uno. */
  agentStatuses: ChatAgentStatusPayload[];
}

/** Forma mínima de una fila de chat_message con sus adjuntos y su autor. */
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
  userAuthor?: { id: string; name: string | null; email: string; image: string | null } | null;
  agentAuthor?: { id_agent: number; display_name: string; avatar_url: string | null } | null;
  /** El mensaje citado, UN solo nivel (ver messageInclude). */
  replyTo?: {
    id: number;
    body: string;
    role: string;
    userAuthor?: { name: string | null; email: string } | null;
    agentAuthor?: { display_name: string } | null;
  } | null;
};

/**
 * `include` con el que hay que leer un mensaje para que `serializeMessage`
 * pueda resolver el autor. Se exporta para que ninguna ruta lo escriba a mano
 * y termine devolviendo mensajes sin autor.
 */
export const messageInclude = {
  attachments: true,
  userAuthor: { select: { id: true, name: true, email: true, image: true } },
  agentAuthor: { select: { id_agent: true, display_name: true, avatar_url: true } },
  // El mensaje CITADO, un solo nivel. Sin recursión a propósito: si A cita a B
  // y B cita a C, la cita de A muestra a B y ahí se para. Traer la cadena
  // completa serían tantas consultas como saltos, y en pantalla no se pinta
  // más de un nivel.
  replyTo: {
    select: {
      id: true,
      body: true,
      role: true,
      userAuthor: { select: { name: true, email: true } },
      agentAuthor: { select: { display_name: true } },
    },
  },
} as const;

export function serializeMessage(row: MessageRow): ChatMessagePayload {
  let author: ChatAuthorPayload | null = null;
  if (row.agentAuthor) {
    author = {
      kind: 'agent',
      id: row.agentAuthor.id_agent,
      name: row.agentAuthor.display_name,
      avatarUrl: row.agentAuthor.avatar_url,
    };
  } else if (row.userAuthor) {
    author = {
      kind: 'user',
      id: row.userAuthor.id,
      // El correo como respaldo: un usuario sin nombre no puede quedar como
      // un mensaje anónimo en un grupo.
      name: row.userAuthor.name?.trim() || row.userAuthor.email,
      avatarUrl: row.userAuthor.image,
    };
  }

  return {
    id: row.id,
    role: row.role,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    deliveredAt: row.delivered_at ? row.delivered_at.toISOString() : null,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    attachments: (row.attachments ?? []).map(serializeAttachment),
    author,
    replyTo: row.replyTo
      ? {
          idMessage: row.replyTo.id,
          author:
            row.replyTo.userAuthor?.name?.trim() ||
            row.replyTo.userAuthor?.email ||
            row.replyTo.agentAuthor?.display_name ||
            (row.replyTo.role === 'agent' ? 'Asistente' : 'Sistema'),
          // Se recorta ACÁ y no en el navegador: el cuerpo citado puede ser un
          // mensaje larguísimo y no tiene sentido mandarlo entero para pintar
          // dos renglones.
          preview: toPreview(row.replyTo.body),
        }
      : null,
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
  company: { select: { id_company: true, company: true } },
  statuses: true,
  participants: {
    select: {
      id_user: true,
      id_agent: true,
      role: true,
      user: { select: { id: true, name: true, email: true, image: true } },
      agent: {
        select: { id_agent: true, display_name: true, handle: true, avatar_url: true },
      },
    },
  },
  messages: {
    orderBy: { id: 'desc' as const },
    take: 1,
    select: { id: true, role: true, body: true, created_at: true },
  },
};

type ConversationRow = {
  id: number;
  title: string | null;
  kind: string;
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
  company: { id_company: number; company: string } | null;
  statuses: {
    id_agent: number;
    state: string;
    label: string | null;
    tasks: string | null;
    updated_at: Date;
  }[];
  participants: {
    id_user: string | null;
    id_agent: number | null;
    role: string;
    user: { id: string; name: string | null; email: string; image: string | null } | null;
    agent: {
      id_agent: number;
      display_name: string;
      handle: string | null;
      avatar_url: string | null;
    } | null;
  }[];
  messages: { id: number; role: string; body: string; created_at: Date }[];
};

export function serializeConversation(
  row: ConversationRow,
  unreadCount: number
): ChatConversationPayload {
  const last = row.messages[0];
  const esGrupo = row.kind === 'group';

  const agentStatuses: ChatAgentStatusPayload[] = row.statuses.map((s) => ({
    idAgent: s.id_agent,
    state: s.state,
    label: s.label,
    tasks: parseAgentTasks(s.tasks),
    updatedAt: s.updated_at.toISOString(),
  }));

  // En un hilo directo el indicador es el del agente del hilo. En un grupo se
  // deja en null a propósito: elegir "uno" de varios agentes daría una lectura
  // falsa de lo que está pasando.
  const delAnfitrion = agentStatuses.find((s) => s.idAgent === row.agent.id_agent) ?? null;

  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
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
    company: row.company
      ? { idCompany: row.company.id_company, companyName: row.company.company }
      : null,
    participants: esGrupo
      ? row.participants.map((p) =>
          p.agent
            ? {
                kind: 'agent' as const,
                id: p.agent.id_agent,
                name: p.agent.display_name,
                avatarUrl: p.agent.avatar_url,
                handle: p.agent.handle,
                role: p.role,
              }
            : {
                kind: 'user' as const,
                id: p.user?.id ?? p.id_user ?? '',
                name: p.user?.name?.trim() || p.user?.email || 'Sin nombre',
                avatarUrl: p.user?.image ?? null,
                handle: null,
                role: p.role,
              }
        )
      : null,
    lastMessage: last
      ? {
          id: last.id,
          role: last.role,
          preview: toPreview(last.body),
          createdAt: last.created_at.toISOString(),
        }
      : null,
    unreadCount,
    agentStatus: esGrupo
      ? null
      : delAnfitrion
        ? {
            state: delAnfitrion.state,
            label: delAnfitrion.label,
            tasks: delAnfitrion.tasks,
            updatedAt: delAnfitrion.updatedAt,
          }
        : null,
    agentStatuses,
  };
}

/**
 * Bandeja del usuario: sus hilos directos MÁS los grupos en los que está.
 *
 * Los hilos directos solo aparecen si el usuario TODAVÍA tiene permiso sobre
 * ese agente: si le revocan el subproceso, los hilos viejos desaparecen igual
 * que desaparece el agente. El filtro por `id_user` es lo que ata cada hilo a
 * su dueño; el correo viene de la sesión.
 *
 * Los grupos aparecen si el usuario es PARTICIPANTE y sigue teniendo el módulo
 * habilitado en la empresa del grupo — la misma pareja de condiciones que
 * comprueba `assertGroupAccess`, y por el mismo motivo: que un permiso
 * revocado cierre también lo viejo.
 */
/**
 * QUÉ CONVERSACIONES ALCANZA ESTE USUARIO — la condición de acceso, en un
 * solo sitio.
 *
 * Devuelve el `OR` que hay que meterle a cualquier consulta sobre
 * conversaciones (o sobre mensajes, a través de la relación), y `null` cuando
 * la persona no tiene el módulo habilitado en ninguna empresa.
 *
 * Está extraído a propósito: la bandeja y el buscador de mensajes tienen que
 * ver EXACTAMENTE lo mismo. Con la condición copiada en dos consultas, el día
 * que se ajuste una se olvida la otra, y esa clase de olvido no se nota
 * probando —se nota cuando alguien encuentra por el buscador un mensaje de una
 * conversación que no le corresponde—.
 *
 * Las dos ramas dicen lo mismo que `assertGroupAccess`, y por el mismo motivo:
 * que un permiso revocado cierre también lo viejo.
 */
export async function conversationScopeFor(
  userId: string,
  userEmail: string
): Promise<Prisma.ChatConversationWhereInput[] | null> {
  const access = await getChatAccess(userEmail);
  if (!access.canUseChat) return null;

  const allowedAgentIds = access.agents.map((a) => a.idAgent);
  const empresasDelModulo = access.companies.map((c) => c.idCompany);

  return [
    // Hilos directos: suyos y con un agente que todavía puede usar.
    ...(allowedAgentIds.length > 0
      ? [{ kind: 'direct', id_user: userId, id_agent: { in: allowedAgentIds } }]
      : []),
    // Grupos: es participante y conserva el módulo en esa empresa.
    {
      kind: 'group',
      participants: { some: { id_user: userId } },
      OR: [
        { id_company: null },
        ...(empresasDelModulo.length > 0 ? [{ id_company: { in: empresasDelModulo } }] : []),
      ],
    },
  ];
}

export async function listUserConversations(
  userId: string,
  userEmail: string,
  opts: { archived: boolean }
): Promise<ChatConversationPayload[]> {
  const alcance = await conversationScopeFor(userId, userEmail);
  if (!alcance) return [];

  const rows = await prisma.chatConversation.findMany({
    where: { archived: opts.archived, OR: alcance },
    include: conversationInclude,
    orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
  });

  if (rows.length === 0) return [];

  const directos = rows.filter((r) => r.kind !== 'group').map((r) => r.id);
  const grupos = rows.filter((r) => r.kind === 'group');

  const noLeidos = new Map<number, number>();

  // Hilos directos: no leídos = mensajes del AGENTE sin marcar. Un solo
  // groupBy para todos.
  if (directos.length > 0) {
    const unread = await prisma.chatMessage.groupBy({
      by: ['id_conversation'],
      where: { id_conversation: { in: directos }, role: 'agent', read_at: null },
      _count: { _all: true },
    });
    for (const u of unread) noLeidos.set(u.id_conversation, u._count._all);
  }

  // Grupos: no leídos = mensajes posteriores a MI marca de agua que no escribí
  // yo. `read_at` no sirve aquí (ver el comentario de la columna
  // chat_participant.last_read_message_id).
  if (grupos.length > 0) {
    const marcas = await prisma.chatParticipant.findMany({
      where: { id_conversation: { in: grupos.map((g) => g.id) }, id_user: userId },
      select: { id_conversation: true, last_read_message_id: true },
    });
    const marcaPorGrupo = new Map(marcas.map((m) => [m.id_conversation, m.last_read_message_id ?? 0]));

    const conteos = await Promise.all(
      grupos.map(async (g) => {
        const desde = marcaPorGrupo.get(g.id) ?? 0;
        const n = await prisma.chatMessage.count({
          where: {
            id_conversation: g.id,
            id: { gt: desde },
            // Lo que yo mismo escribí nunca es un no leído.
            NOT: { id_user_author: userId },
            role: { not: 'system' },
          },
        });
        return [g.id, n] as const;
      })
    );
    for (const [id, n] of conteos) noLeidos.set(id, n);
  }

  return rows.map((row) => serializeConversation(row, noLeidos.get(row.id) ?? 0));
}

/**
 * Carga UNA conversación ya serializada (después de validar el acceso).
 *
 * `userId` es opcional solo por compatibilidad con el camino directo; en un
 * GRUPO hace falta para contar los no leídos de ESA persona (cada integrante
 * tiene su propia marca de agua). Sin él, un grupo se devuelve con 0.
 */
export async function getConversationPayload(
  conversationId: number,
  userId?: string
): Promise<ChatConversationPayload | null> {
  const row = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  });
  if (!row) return null;

  let unreadCount = 0;
  if (row.kind === 'group') {
    if (userId) {
      const mio = await prisma.chatParticipant.findFirst({
        where: { id_conversation: conversationId, id_user: userId },
        select: { last_read_message_id: true },
      });
      unreadCount = await prisma.chatMessage.count({
        where: {
          id_conversation: conversationId,
          id: { gt: mio?.last_read_message_id ?? 0 },
          NOT: { id_user_author: userId },
          role: { not: 'system' },
        },
      });
    }
  } else {
    unreadCount = await prisma.chatMessage.count({
      where: { id_conversation: conversationId, role: 'agent', read_at: null },
    });
  }

  return serializeConversation(row, unreadCount);
}
