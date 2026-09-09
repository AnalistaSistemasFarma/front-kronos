import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig } from '@/lib/orion/config';
import { returnDocumentFromSigner } from '@/lib/orion/service';

/**
 * Firmante en turno devuelve el documento al coordinador (Orion DEVUELTO).
 * POST /api/integrations/orion/return-document
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    const userId = session?.user?.id;
    if (!email || !userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    if (!getOrionConfig().enabled) {
      return NextResponse.json(
        { error: 'Integración Orion no configurada en el servidor' },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const fileId = body.fileId ? String(body.fileId).trim() : null;
    const reason = String(body.reason || '').trim();

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }
    if (reason.length < 3) {
      return NextResponse.json(
        { error: 'Indique el motivo de la devolución (mín. 3 caracteres).' },
        { status: 400 }
      );
    }

    const result = await withMssqlPool((pool) =>
      returnDocumentFromSigner(pool, {
        requestId,
        userId: String(userId),
        userEmail: email,
        fileId,
        reason,
      })
    );

    return NextResponse.json(
      {
        success: true,
        state: result.state,
        documents: result.bag.documents,
        fileId: result.fileId,
        tasksUpdated: result.tasksUpdated,
        requestClosed: result.requestClosed,
        message: 'Documento devuelto al coordinador para corrección.',
      },
      { status: 200 }
    );
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
