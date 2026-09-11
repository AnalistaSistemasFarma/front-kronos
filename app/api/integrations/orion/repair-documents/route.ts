import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { repairOrionDocuments } from '@/lib/orion/service';

/**
 * Fuerza corrección de PDFs/versiones Orion ya existentes.
 * POST /api/integrations/orion/repair-documents
 * body: { requestId?: number, all?: boolean }
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const isAdmin =
      session.user.role === 'admin' || session.user.role === 'superadmin';
    const body = (await req.json().catch(() => ({}))) as {
      requestId?: number;
      all?: boolean;
    };

    if (body.all && !isAdmin) {
      return NextResponse.json(
        { error: 'Solo administradores pueden reparar todos los documentos' },
        { status: 403 }
      );
    }

    const requestId = Number(body.requestId);
    if (!body.all && (!Number.isInteger(requestId) || requestId <= 0)) {
      return NextResponse.json(
        { error: 'Indique requestId o all: true' },
        { status: 400 }
      );
    }

    const result = await withMssqlPool((pool) =>
      repairOrionDocuments(pool, {
        requestId: body.all ? null : requestId,
        all: Boolean(body.all),
      })
    );

    return NextResponse.json({
      ok: true,
      total: result.total,
      repaired: result.repaired,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    const status = (err as { status?: number })?.status || 500;
    return NextResponse.json({ error: message }, { status });
  }
}
