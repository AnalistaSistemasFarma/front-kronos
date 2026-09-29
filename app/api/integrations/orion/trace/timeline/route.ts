import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '@/lib/mssqlPool';
import { getOrionDocumentTimeline } from '@/lib/orion/client';
import { resolveOrionTraceScope } from '@/lib/orion/traceAccess';

/**
 * GET /api/integrations/orion/trace/timeline?orionDocumentId=
 * GET /api/integrations/orion/trace/timeline?requestId=&fileId=
 * Hoja de vida completa (todas las versiones y eventos SynerLink + Orion).
 * Se valida que la solicitud pertenezca a una empresa con permiso de trazabilidad.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orionDocumentId = String(searchParams.get('orionDocumentId') || '').trim();
    const requestId = Number(searchParams.get('requestId'));
    const fileId = String(searchParams.get('fileId') || '').trim();
    const byRequest = Number.isInteger(requestId) && requestId > 0 && Boolean(fileId);
    if (!orionDocumentId && !byRequest) {
      return NextResponse.json(
        { error: 'Indique orionDocumentId o requestId + fileId' },
        { status: 400 }
      );
    }

    const result = await getOrionDocumentTimeline(
      orionDocumentId ? { orionDocumentId } : { synerlinkRequestId: requestId, fileId }
    );
    if (!result.ok || !result.data) {
      const upstream = result.status >= 400 && result.status < 500 ? result.status : 502;
      return NextResponse.json(
        { error: result.error || 'Orion no devolvió la hoja de vida', code: result.code },
        { status: upstream }
      );
    }
    const timeline = result.data;

    const allowed = await withMssqlPool(async (pool) => {
      const scope = await resolveOrionTraceScope(pool, {
        id: session.user?.id ? String(session.user.id) : null,
        email,
        role: session.user?.role,
      });
      if (scope.isAdmin) return true;
      const synerlinkRequestId = Number(timeline.synerlinkRequestId ?? (byRequest ? requestId : 0));
      if (!Number.isInteger(synerlinkRequestId) || synerlinkRequestId <= 0) return false;
      const company = await pool
        .request()
        .input('id', sql.Int, synerlinkRequestId)
        .query(`SELECT TOP 1 id_company FROM requests_general WHERE id = @id`);
      const companyId = Number(company.recordset[0]?.id_company);
      return scope.companies.some((c) => c.id === companyId);
    });

    if (!allowed) {
      return NextResponse.json(
        { error: 'No tiene permiso de trazabilidad sobre este documento.' },
        { status: 403 }
      );
    }

    return NextResponse.json(timeline);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
