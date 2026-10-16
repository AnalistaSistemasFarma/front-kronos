import { NextRequest } from 'next/server';
import { searchPeople } from '../../../../../lib/chat/people';
import { MIN_PEOPLE_SEARCH_CHARS } from '../../../../../lib/chat/people-rules';
import {
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../lib/chat/http';

/**
 * Buscador de PERSONAS del piloto "Personas" del chat.
 *
 *   GET /api/chat/people/search?q=ana
 *
 * Devuelve como máximo veinte personas con las que el usuario de la sesión
 * PUEDE iniciar una conversación (regla D2, lib/chat/people-rules.ts): activas,
 * no proveedores y con el Chat en una empresa donde él tiene el piloto. Con
 * menos de dos caracteres responde vacío: no es un directorio del grupo.
 *
 * Seguridad: el usuario sale de la sesión; el cliente solo manda el texto.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const q = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 80);
    if (q.trim().length < MIN_PEOPLE_SEARCH_CHARS) return jsonNoStore({ people: [] });

    const people = await searchPeople(user.id, q);
    return jsonNoStore({ people });
  } catch (error) {
    return serverError('GET /api/chat/people/search', error);
  }
}
