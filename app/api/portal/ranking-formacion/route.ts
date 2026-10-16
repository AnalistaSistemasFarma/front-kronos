import { NextRequest, NextResponse } from 'next/server';
import { identificar } from '@/lib/portal/acceso';
import { vistaPublica } from '@/lib/portal/ranking-formacion';
import { cargarRanking } from '@/lib/portal/ranking-formacion-servidor';

/**
 * FORMACIÓN — TOP 10 de estudiantes (Cristian Baldión, 2026-10-16).
 *
 *   GET /api/portal/ranking-formacion
 *     →  { top: [{ puesto, nombre, cursos, nota, esUsted }], total, usted: { ... } | null }
 *
 * Los mejores estudiantes: más cursos completados y, a igual número, mejor nota promedio en las evaluaciones (regla completa en
 * `lib/portal/ranking-formacion.ts`). Lo ve cualquiera que entre a Formación. Solo salen el NOMBRE, los cursos y la nota: nunca el
 * correo, la cédula ni el detalle de las evaluaciones. `esUsted` marca la fila de quien pregunta.
 */
export async function GET(request: NextRequest) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const ranking = await cargarRanking();
    return NextResponse.json(vistaPublica(ranking, quien.correo), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    // Solo el tipo del error: un mensaje de la base puede traer correos.
    console.error('[portal] GET /api/portal/ranking-formacion:', (error as Error).name);
    return NextResponse.json({ error: 'No se pudo cargar el top de estudiantes. Intente en un momento.' }, { status: 500 });
  }
}
