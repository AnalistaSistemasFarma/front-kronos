import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getNivelSalas } from '../../../../lib/salas/access';
import { esFecha, hoyBogota } from '../../../../lib/salas/fechas';
import { respuestaError } from '../../../../lib/salas/respuesta';
import { ocupacionDelDia } from '../../../../lib/salas/servicio';

export const dynamic = 'force-dynamic';

/** GET /api/salas/ocupacion?fecha=YYYY-MM-DD — agenda del día de cada sala (privados como «Ocupado»). */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const nivel = await getNivelSalas(session.user.email);
    if (!nivel) return NextResponse.json({ error: 'No tiene acceso al módulo de salas.' }, { status: 403 });

    const fecha = new URL(req.url).searchParams.get('fecha') ?? hoyBogota();
    if (!esFecha(fecha)) return NextResponse.json({ error: 'La fecha no es válida.' }, { status: 400 });

    const salas = await ocupacionDelDia(fecha, session.user.email, nivel);
    return NextResponse.json({ fecha, salas }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return respuestaError(err, 'ocupación');
  }
}
