import { NextResponse } from 'next/server';
import { pendientesDe } from '@/lib/formacion/servidor';
import { correoDeSesion, SIN_CACHE } from '@/lib/formacion/sesion';

/**
 * MÓDULO FORMACIÓN — pendientes por ver de quien tiene la sesión (2026-10-26).
 *
 *   GET /api/formacion/pendientes
 *
 * Alimenta el ícono de Formación del header: cursos o videos divulgados que la
 * persona aún no abre. No exige el permiso del módulo: los pendientes son de
 * quien los recibe.
 */
export async function GET() {
  const correo = await correoDeSesion();
  if (!correo) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401, headers: SIN_CACHE });
  try {
    return NextResponse.json(await pendientesDe(correo), { headers: SIN_CACHE });
  } catch (error) {
    console.error('[formacion] GET /api/formacion/pendientes', error);
    return NextResponse.json({ error: 'No se pudieron cargar los pendientes.' }, { status: 502, headers: SIN_CACHE });
  }
}
