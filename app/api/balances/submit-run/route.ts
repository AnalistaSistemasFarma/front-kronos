import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { userCanAccessCompany } from '../../../../lib/balances/access';
import { getBalanceCompany } from '../../../../lib/balances/companies';
import { getBalancesConfigurationError } from '../../../../lib/balances/adminPool';
import {
  executeCompanyBalance,
  startCompanyBalance,
  BalanceRunLockedError,
} from '../../../../lib/balances/runBalance';

/**
 * Dispara el balance (normal + acumulado) de UNA empresa.
 *
 * POST /api/balances/submit-run?companyId=<1>
 *
 * Sprint 2: registra la corrida y devuelve 202 inmediatamente. La ejecución
 * continúa en background; la interfaz consulta la tabla `balance_run`.
 *
 * ALCANCE HABILITADO: Farmalogica, OLP y GSS; el servidor rechaza las
 * empresas deshabilitadas en lib/balances/companies.ts. Ejecuta el SQL extraído del job
 * compartido en el 10.7, sin pasar por sp_start_job.
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
      return NextResponse.json({ error: 'Empresa no soportada por el módulo de Balances.' }, { status: 400 });
    }
    if (!company.enabled) {
      return NextResponse.json(
        { error: `La ejecución de balances para ${company.displayName} no está habilitada actualmente.` },
        { status: 403 }
      );
    }

    const canRun = await userCanAccessCompany(userEmail, companyId);
    if (!canRun) {
      return NextResponse.json({ error: 'No tiene acceso a esta empresa.' }, { status: 403 });
    }

    const configurationError = getBalancesConfigurationError();
    if (configurationError) {
      return NextResponse.json(
        { error: `Balances no está configurado para PRUEBAS: ${configurationError}` },
        { status: 503 }
      );
    }

    const runId = await startCompanyBalance(company, userEmail);
    void executeCompanyBalance(company, runId).catch((error) => {
      // La ejecución registra el fallo cuando puede; esto evita una rejection
      // no manejada si el proceso pierde conexión durante la finalización.
      console.error('Balance background run failed', error);
    });

    return NextResponse.json(
      { run: { id: runId, id_company: company.idCompany, status: 'running' } },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof BalanceRunLockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
