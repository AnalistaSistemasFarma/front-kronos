import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig } from '@/lib/orion/config';
import { setOrionDocumentSignatureIntent } from '@/lib/orion/service';

/**
 * Marca un PDF de la solicitud como para firmar o solo ver.
 * POST /api/integrations/orion/signature-intent
 * Body: { requestId, fileId, intent: 'sign'|'view', fileName?, originalFileUrl? }
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    const userId = session?.user?.id != null ? String(session.user.id) : '';
    if (!email || !userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const cfg = getOrionConfig();
    if (!cfg.enabled) {
      return NextResponse.json(
        { error: 'Integración Orion no configurada en el servidor' },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const fileId = String(body.fileId || '').trim();
    const intent = String(body.intent || '').trim().toLowerCase();
    const role = session.user?.role;
    const isAdmin = role === 'admin' || role === 'superadmin';

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }
    if (!fileId) {
      return NextResponse.json({ error: 'fileId es obligatorio' }, { status: 400 });
    }
    if (intent !== 'sign' && intent !== 'view') {
      return NextResponse.json(
        { error: 'intent debe ser sign o view' },
        { status: 400 }
      );
    }

    const result = await withMssqlPool((pool) =>
      setOrionDocumentSignatureIntent(pool, {
        requestId,
        userId,
        userEmail: email,
        isAdmin,
        fileId,
        fileName: body.fileName ? String(body.fileName) : null,
        intent,
        originalFileUrl: body.originalFileUrl ? String(body.originalFileUrl) : null,
      })
    );

    return NextResponse.json({
      success: true,
      state: result.state,
      documents: result.bag.documents,
      fileId: result.fileId,
      intent,
    });
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
