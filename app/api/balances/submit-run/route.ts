import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { userCanAccessCompany } from '../../../../lib/balances/access';
import { getBalanceCompany } from '../../../../lib/balances/companies';
import { runCompanyBalance, BalanceRunLockedError } from '../../../../lib/balances/runBalance';

/**
 * Dispara el balance (normal + acumulado) de UNA empresa.
 *
 * POST /api/balances/submit-run?companyId=<1|3|8>
 *
 * Sprint 1: ejecución SÍNCRONA (el request espera a que termine). El balance
 * normal es rápido; el acumulado puede tardar más — el timeout del pool está
 * en 120s (ver adminPool.ts). Sprint 2 lo vuelve asíncrono con estado en vivo
 * (polling de la tabla `balance_run`), pero hoy es deliberadamente simple:
 * "clic → espera → resultado", igual que el botón viejo de SAPSEND.
 *
 * ALCANCE: solo Farmalogica/OLP/GSS (ver lib/balances/companies.ts). Ejecuta
 * el SQL EXACTO extraído del job compartido de SQL Agent en el 10.7, SIN
 * pasar por sp_start_job — no toca el job compartido.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userEmail = session.user.email;

    const companyIdRaw = request.nextUrl.searchParams.get('companyId');
    const companyId = Number(companyIdRaw);
    if (!companyIdRaw || !Number.isFinite(companyId)) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 });
    }

    const company = getBalanceCompany(companyId);
    if (!company) {
      return NextResponse.json(
        { error: 'Empresa no soportada por el módulo de Balances (Sprint 1: solo Farmalogica/OLP/GSS).' },
        { status: 400 }
      );
    }

    const canRun = await userCanAccessCompany(userEmail, companyId);
    if (!canRun) {
      return NextResponse.json({ error: 'No tiene acceso a esta empresa.' }, { status: 403 });
    }

    const result = await runCompanyBalance(company, userEmail);

    return NextResponse.json({ run: result }, { status: result.ok ? 200 : 502 });
  } catch (error) {
    if (error instanceof BalanceRunLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
