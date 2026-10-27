import { listarCorridas } from '../../../../lib/transferencias-nabuco/db';
import { errorResponse, getNabucoContext, jsonNoStore, parseId, requireEmpresa } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** GET ?company= — historial de corridas (scheduled_job_run) de las configs de la empresa. */
export async function GET(request: Request) {
  const ctx = await getNabucoContext();
  if (ctx instanceof Response) return ctx;
  const company = parseId(new URL(request.url).searchParams.get('company'));
  const denegado = requireEmpresa(ctx, company, 'leer');
  if (denegado) return denegado;
  try {
    return jsonNoStore({ corridas: await listarCorridas(company!) });
  } catch (e) {
    return errorResponse(e, 'corridas');
  }
}
