import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { getNivelSalas } from '../../../../../lib/salas/access';
import { respuestaError } from '../../../../../lib/salas/respuesta';
import { cancelar } from '../../../../../lib/salas/servicio';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/salas/reservas/{iCalUId}?sala=&fecha=YYYY-MM-DD&alcance=dia|serie
 * Solo el organizador o un administrador del módulo (403 para los demás).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const q = new URL(req.url).searchParams;
    const nivel = await getNivelSalas(session.user.email);
    await cancelar(session.user.email, nivel, {
      salaId: q.get('sala') ?? '',
      iCalUId: String(id ?? '').slice(0, 1000),
      fecha: q.get('fecha') ?? '',
      alcance: q.get('alcance') === 'serie' ? 'serie' : 'dia',
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return respuestaError(err, 'cancelar');
  }
}
