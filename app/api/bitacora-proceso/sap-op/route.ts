import { buscarOpsLiberadas } from '../../../../lib/bitacora-proceso/sap';
import { SapError } from '../../../../lib/sap/serviceLayer';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, requireCompany } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bitacora-proceso/sap-op?company=1&q=texto — SOLO LECTURA (solo Gestión).
 * OP liberadas de SAP de la empresa (por artículo, descripción, lote o número).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const access = requireCompany(ctx, parseCompanyParam(request.url), 'canManage');
    if (access instanceof Response) return access;
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
    if (q.length < 2) return jsonNoStore({ ops: [] });
    const ops = await buscarOpsLiberadas(access.idCompany, q);
    return jsonNoStore({ ops });
  } catch (error) {
    if (error instanceof SapError) {
      console.error('[bitacora-proceso/sap-op]', error.message);
      return jsonNoStore({ error: 'No se pudo consultar SAP en este momento. Puede escribir el producto y el lote a mano.' }, 502);
    }
    return errorResponse(error, 'sap-op');
  }
}
