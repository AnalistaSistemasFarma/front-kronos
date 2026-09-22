import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getUserAccessibleCompanies } from '../../../../lib/balances/access';
import { prisma } from '../../../../lib/prisma';

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

    const runs = await prisma.balanceRun.findMany({
      where: { id_company: { in: companies } },
      orderBy: { id: 'desc' },
      take: limit,
      select: {
        id: true,
        id_company: true,
        triggered_by: true,
        status: true,
        started_at: true,
        finished_at: true,
        balance_duration_ms: true,
        acumulado_duration_ms: true,
        error_message: true,
      },
    });

    return NextResponse.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
