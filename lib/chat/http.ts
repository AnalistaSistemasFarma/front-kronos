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
 * Resuelve sesión + PROPIEDAD de la conversación de una sola vez.
 *
 * Es el guardia anti-IDOR de todos los endpoints con `[id]`: el id que llega
 * del cliente solo sirve si la conversación es del usuario de la sesión Y el
 * usuario todavía tiene permiso sobre el agente de ese hilo
 * (assertConversationOwnership, lib/chat/access.ts).
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
  | { user: ChatSessionUser; conversationId: number; idAgent: number };

export async function guardConversation(rawId: string): Promise<ConversationGuard> {
  const user = await resolveSessionUser();
  if (!user) return { response: unauthorized() };

  const conversationId = Number.parseInt(rawId, 10);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return { response: badRequest('Id de conversación inválido.') };
  }

  const owned = await assertConversationOwnership(user.email, conversationId);
  if (!owned) {
    return {
      response: NextResponse.json(
        { error: 'Conversación no encontrada.' },
        { status: 404, headers: NO_STORE }
      ),
    };
  }

  return { user, conversationId: owned.id, idAgent: owned.idAgent };
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
