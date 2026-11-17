import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getNivelSalas } from '../../../../lib/salas/access';
import {
  MENSAJE_SOLO_LECTURA,
  credencialesGraph,
  esSoloLectura,
  salasDelAmbiente,
  salasPublicas,
} from '../../../../lib/salas/config';
import { hoyBogota } from '../../../../lib/salas/fechas';
import { respuestaError } from '../../../../lib/salas/respuesta';

export const dynamic = 'force-dynamic';

/**
 * Configuración del módulo para el navegador: nivel del usuario, salas
 * (id, nombre y ventana; nunca el buzón), modo de solo lectura y fecha de hoy
 * en Bogotá. No expone secretos.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const nivel = await getNivelSalas(session.user.email);
    if (!nivel) return NextResponse.json({ nivel: null }, { headers: { 'Cache-Control': 'no-store' } });

    const salas = salasDelAmbiente();
    return NextResponse.json(
      {
        nivel,
        configurado: Boolean(credencialesGraph()) && salas.length > 0,
        soloLectura: esSoloLectura(),
        mensajeSoloLectura: MENSAJE_SOLO_LECTURA,
        hoy: hoyBogota(),
        salas: salasPublicas(salas),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return respuestaError(err, 'config');
  }
}
