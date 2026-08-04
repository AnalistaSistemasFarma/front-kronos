import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sendFilesToSapsend } from '../../../../lib/sapsend/files.js';

// POST /api/requests-general/sapsend-files  { id }
// Reenvía a SAPSEND los adjuntos (en OneDrive) de la solicitud. Seguro por idempotencia (reemplaza
// por nombre). Usado automáticamente tras subir archivos y por el botón "Reenviar archivos".
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Se requiere un id de solicitud válido' }, { status: 400 });
    }

    const result = await sendFilesToSapsend(id);
    // 202 cuando el caso aún no existe en SAPSEND (pendiente de reintento); 200/502 según resultado.
    const status = result?.pending ? 202 : result?.ok ? 200 : 502;
    return NextResponse.json(result, { status });
  } catch (err) {
    console.error('Error en sapsend-files:', err);
    return NextResponse.json(
      { error: 'Error procesando el envío de archivos', details: err.message },
      { status: 500 }
    );
  }
}
