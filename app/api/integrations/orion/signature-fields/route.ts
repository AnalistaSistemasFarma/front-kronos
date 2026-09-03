import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import type { SignatureFieldPlacement } from '@/lib/orion/signatureFields';
import { persistOrionSignatureFields, userCanManageOrionRequest } from '@/lib/orion/service';

/**
 * Guarda ubicaciones de firma en Orion (embed API) y en el bag local.
 * POST /api/integrations/orion/signature-fields
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    const email = session?.user?.email;
    if (!userId || !email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const fileId = String(body.fileId || '').trim();
    const fields = (body.signatureFields ?? []) as SignatureFieldPlacement[];

    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }
    if (!Array.isArray(fields)) {
      return NextResponse.json({ error: 'signatureFields debe ser un arreglo' }, { status: 400 });
    }

    const role = session.user?.role;
    const isAdmin = role === 'admin' || role === 'superadmin';
    const canManage = await withMssqlPool((pool) =>
      userCanManageOrionRequest(pool, requestId, String(userId), isAdmin)
    );
    if (!canManage) {
      return NextResponse.json(
        { error: 'No tiene permiso para gestionar ubicaciones de firma' },
        { status: 403 }
      );
    }

    const result = await withMssqlPool((pool) =>
      persistOrionSignatureFields(pool, { requestId, fileId, fields })
    );

    return NextResponse.json(
      {
        success: true,
        state: result.state,
        documents: result.bag.documents,
        fileId,
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
