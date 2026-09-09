import { NextRequest } from 'next/server';
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';
import { MIN_SEARCH_CHARS } from '../../../../lib/chat/client';
import { searchUserMessages } from '../../../../lib/chat/search';

/**
 * Buscador de mensajes del chat.
 *
 *   GET /api/chat/search?q=cargue
 *
 * Seguridad: exige sesión y resuelve el usuario desde el CORREO de la sesión.
 * El cliente no manda ningún identificador, así que no hay nada que suplantar,
 * y el alcance de la búsqueda sale de `conversationScopeFor` —el mismo de la
 * bandeja—, nunca de un parámetro.
 *
 * Un término corto devuelve lista vacía con 200, no un error: para la interfaz
 * "todavía no hay nada que buscar" y "no encontré nada" se pintan igual, y
 * distinguirlos con un código de estado solo agrega ruido en la consola.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
    const results = await searchUserMessages(user.id, user.email, q);

    return jsonNoStore({ results, query: q, minChars: MIN_SEARCH_CHARS });
  } catch (error) {
    return serverError('GET /api/chat/search', error);
  }
}
