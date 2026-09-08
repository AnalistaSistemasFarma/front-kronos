/**
 * Ayudas comunes de los endpoints del chat.
 *
 * El objetivo es que la comprobación de seguridad de cada ruta quepa en tres
 * líneas y se lea igual en todas: cuando el preámbulo de seguridad es largo y
 * distinto en cada archivo, es cuestión de tiempo que alguien lo omita. Hoy 57
 * de las 140 rutas de la app no validan sesión; este módulo existe para que el
 * chat no engorde esa lista.
 */
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import { prisma } from '../prisma';
import { assertConversationOwnership } from './access';
import { assertGroupAccess, type AgenteMencionable, type ParticipantRole } from './groups';

/** El chat nunca se cachea: es una bandeja en vivo. */
export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export function jsonNoStore(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status ?? 200, headers: NO_STORE });
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
}

export function forbidden(message = 'No tiene permiso sobre este recurso.') {
  return NextResponse.json({ error: message }, { status: 403, headers: NO_STORE });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
}

export function serverError(context: string, error: unknown) {
  console.error(`[chat] ${context}:`, error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
}

/** Usuario de la sesión, resuelto SIEMPRE desde el servidor. */
export interface ChatSessionUser {
  id: string;
  email: string;
}

/**
 * Valida la sesión de NextAuth y resuelve el usuario.
 *
 * El identificador del usuario sale del correo de la SESIÓN, jamás de un
 * parámetro del cliente: así no hay nada que suplantar. Devuelve null cuando no
 * hay sesión válida o el correo no corresponde a un usuario activo.
 */
export async function resolveSessionUser(): Promise<ChatSessionUser | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  return { id: user.id, email: user.email };
}

/**
 * Resuelve sesión + ACCESO a la conversación de una sola vez, sirva para un
 * hilo directo o para un grupo.
 *
 * Es el guardia anti-IDOR de todos los endpoints con `[id]`. El id que llega
 * del cliente solo sirve si:
 *
 *   - hilo DIRECTO: la conversación es del usuario de la sesión Y el usuario
 *     todavía tiene permiso sobre el agente de ese hilo
 *     (assertConversationOwnership, lib/chat/access.ts);
 *   - GRUPO: el usuario es participante Y sigue teniendo el módulo habilitado
 *     en la empresa del grupo (assertGroupAccess, lib/chat/groups.ts).
 *
 * Se prueban en ese orden y las dos puertas están ancladas a su `kind`, así
 * que ninguna acepta una conversación de la otra clase. El resultado dice cuál
 * fue (`kind`) para que la ruta pueda ramificar sin volver a consultar.
 *
 * Devuelve un `NextResponse` ya listo cuando algo falla, para que la ruta solo
 * tenga que hacer `if ('response' in guard) return guard.response;`.
 *
 * Se responde 404 —y no 403— cuando la conversación no es suya: distinguirlas
 * le confirmaría a quien sondea ids que "esa conversación existe, pero es de
 * otro". Con 404 no aprende nada.
 */
export type ConversationGuard =
  | { response: NextResponse }
  | {
      user: ChatSessionUser;
      conversationId: number;
      kind: 'direct';
      /** El agente del hilo directo. */
      idAgent: number;
    }
  | {
      user: ChatSessionUser;
      conversationId: number;
      kind: 'group';
      /** Papel del usuario dentro del grupo ('owner' puede administrar). */
      groupRole: ParticipantRole;
      /** Agentes que están en el grupo (para resolver menciones). */
      groupAgents: AgenteMencionable[];
    };

export async function guardConversation(rawId: string): Promise<ConversationGuard> {
  const user = await resolveSessionUser();
  if (!user) return { response: unauthorized() };

  const conversationId = Number.parseInt(rawId, 10);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return { response: badRequest('Id de conversación inválido.') };
  }

  const owned = await assertConversationOwnership(user.email, conversationId);
  if (owned) {
    return { user, conversationId: owned.id, kind: 'direct', idAgent: owned.idAgent };
  }

  const grupo = await assertGroupAccess(user.email, user.id, conversationId);
  if (grupo) {
    return {
      user,
      conversationId: grupo.id,
      kind: 'group',
      groupRole: grupo.role,
      groupAgents: grupo.agentes,
    };
  }

  return {
    response: NextResponse.json(
      { error: 'Conversación no encontrada.' },
      { status: 404, headers: NO_STORE }
    ),
  };
}

/** Lee el cuerpo JSON de una petición sin reventar si viene vacío o corrupto. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Lee el cuerpo de una petición de CREACIÓN DE MENSAJE, que admite dos
 * codificaciones a la vez:
 *
 *   - `application/json`      -> el camino de siempre, solo texto.
 *   - `multipart/form-data`   -> texto MÁS archivos (campo `files`).
 *
 * Devuelve las dos cosas en la misma forma para que la ruta no tenga que
 * ramificar: `fields` se lee igual venga de donde venga (los campos del
 * formulario llegan como texto, que es justo lo que ya esperan
 * `normalizeMessageBody` y `Number(...)`), y `form` solo trae valor cuando hubo
 * multipart, para sacar los adjuntos.
 *
 * Los nombres de los campos NO cambian entre una codificación y otra: el
 * formulario usa `body`, `idConversation`, `state` y `label`, exactamente como
 * el JSON. Un cliente que hoy manda JSON sigue funcionando sin tocar nada.
 */
export interface ChatMessageRequestBody {
  fields: Record<string, unknown>;
  form: FormData | null;
}

export async function readMessageRequest(
  request: Request
): Promise<ChatMessageRequestBody | null> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();

  if (contentType.includes('multipart/form-data')) {
    try {
      const form = await request.formData();
      const fields: Record<string, unknown> = {};
      for (const [key, value] of form.entries()) {
        // Los archivos se sacan aparte (collectChatAttachments); aquí solo
        // interesan los campos de texto.
        if (typeof value === 'string') fields[key] = value;
      }
      return { fields, form };
    } catch {
      return null;
    }
  }

  const parsed = await readJsonBody(request);
  if (!parsed) return null;
  return { fields: parsed, form: null };
}
