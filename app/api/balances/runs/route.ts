import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getUserAccessibleCompanies } from '../../../../lib/balances/access';
import { getBalancesPool, sql } from '../../../../lib/balances/adminPool';

/**
 * Últimas corridas de balances (historial corto), para las empresas a las
 * que el usuario tiene acceso. Sin tiempo real todavía (eso es Sprint 2) —
 * el front puede llamar esto tras un submit-run para refrescar la lista.
 *
 * GET /api/balances/runs?limit=10
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userEmail = session.user.email;

    const companies = await getUserAccessibleCompanies(userEmail);
    if (companies.length === 0) {
      return NextResponse.json({ runs: [] });
    }

    const limitRaw = Number(request.nextUrl.searchParams.get('limit') ?? '10');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;

    const pool = await getBalancesPool();
    const req = pool.request().input('limit', sql.Int, limit);
    // `companies` sale de getUserAccessibleCompanies(), siempre un subconjunto
    // de BALANCE_COMPANIES (enteros fijos del código, no input del usuario) —
    // igual se parametriza cada valor para no armar la lista por concatenación.
    const placeholders = companies.map((id, i) => {
      req.input(`c${i}`, sql.Int, id);
      return `@c${i}`;
    });
    const result = await req.query(`
      SELECT TOP (@limit) id, id_company, triggered_by, status,
             started_at, finished_at, balance_duration_ms, acumulado_duration_ms, error_message
      FROM [dbo].[balance_run]
      WHERE id_company IN (${placeholders.join(',')})
      ORDER BY id DESC
    `);

    return NextResponse.json({ runs: result.recordset });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
