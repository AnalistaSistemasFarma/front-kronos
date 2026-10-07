import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { listOrionDocumentEvents } from '@/lib/orion/documentEvents';
import { userCanViewOrionDocument } from '@/lib/orion/documentAccess';

/** GET /api/integrations/orion/document-events?requestId=1&fileId=... — hoja de vida */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestId = Number(searchParams.get('requestId'));
    const fileId = String(searchParams.get('fileId') || '').trim();
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }

    const role = session.user?.role;
    const isAdmin = role === 'admin' || role === 'superadmin';

    const events = await withMssqlPool(async (pool) => {
      const allowed = await userCanViewOrionDocument(pool, {
        requestId,
        fileId,
        userId: session.user?.id ? String(session.user.id) : null,
        userEmail: String(session.user.email),
        isAdmin,
      });
      if (!allowed) {
        throw Object.assign(new Error('No tiene acceso a la hoja de vida de este documento'), {
          status: 403,
        });
      }
      return listOrionDocumentEvents(pool, { requestId, fileId });
    });

    return NextResponse.json({ success: true, events }, { status: 200 });
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
