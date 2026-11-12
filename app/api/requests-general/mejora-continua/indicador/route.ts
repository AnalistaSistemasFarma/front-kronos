import { NextRequest } from 'next/server';
import { forbidden, jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import { empresasDelIndicador, indicadorDeEmpresa, MejoraError, puedeMejorarFlujos } from '../../../../../lib/workflow/mejora-continua';

export const dynamic = 'force-dynamic';

/**
 * INDICADOR DE AUTOMEJORA del panel de Flujos de trabajo (2026-11-09).
 *
 *   GET [?empresa=3][&refrescar=1] → { empresas, empresa, calculadoEn, total, flujos }
 *
 * Mismos permisos que la mejora continua de cada flujo (admin o subproceso de flujos). Solo lectura.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await puedeMejorarFlujos(user))) return forbidden('Necesita permiso de administración de flujos de trabajo.');
    const empresas = await empresasDelIndicador();
    if (empresas.length === 0) return jsonNoStore({ empresas: [], empresa: null });
    const pedida = Number.parseInt(request.nextUrl.searchParams.get('empresa') ?? '', 10);
    const empresa = empresas.find((e) => e.idCompany === pedida) ?? empresas[0];
    const r = await indicadorDeEmpresa(empresa.idCompany, { refrescar: request.nextUrl.searchParams.get('refrescar') === '1' });
    return jsonNoStore({ empresas, empresa, ...r });
  } catch (error) {
    if (error instanceof MejoraError) return jsonNoStore({ error: error.message }, { status: error.status });
    return serverError('GET /api/requests-general/mejora-continua/indicador', error);
  }
}
