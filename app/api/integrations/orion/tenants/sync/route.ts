import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { checkAdminPrivileges } from '@/lib/access-control';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig } from '@/lib/orion/config';
import { provisionCompaniesInOrion } from '@/lib/orion/tenantRegistry';

/**
 * POST /api/integrations/orion/tenants/sync
 * Crea en Orion las empresas de Kronos que aún no existan allá. Body opcional
 * { companyIds: number[] } para limitar. Solo administradores.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!(await checkAdminPrivileges(session.user.email))) {
      return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
    }
    if (!getOrionConfig().enabled) {
      return NextResponse.json({ error: 'Integración Orion no configurada' }, { status: 503 });
    }

    const body = (await req.json().catch(() => ({}))) as { companyIds?: unknown };
    const companyIds = Array.isArray(body.companyIds)
      ? body.companyIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
      : undefined;

    const summary = await withMssqlPool((pool) => provisionCompaniesInOrion(pool, companyIds));
    return NextResponse.json(
      { ok: !summary.error && summary.failed === 0, ...summary },
      { status: summary.unsupported ? 501 : 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
