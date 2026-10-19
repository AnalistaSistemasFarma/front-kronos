import { buscarOps } from '../../../../lib/bitacora-proceso/sap';
import { SapError } from '../../../../lib/sap/serviceLayer';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, requireCompanyOpen } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bitacora-proceso/sap-op?company=1&q=texto — SOLO LECTURA (quien puede abrir: Gestión o jefe asignado, R3).
 * OP planificadas o liberadas de SAP de la empresa (por artículo, descripción, lote o número; B5).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const open = await requireCompanyOpen(ctx, parseCompanyParam(request.url));
    if (open instanceof Response) return open;
    const { access } = open;
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
    if (q.length < 2) return jsonNoStore({ ops: [] });
    const ops = await buscarOps(access.idCompany, q);
    return jsonNoStore({ ops });
  } catch (error) {
    if (error instanceof SapError) {
      console.error('[bitacora-proceso/sap-op]', error.message);
      return jsonNoStore({ error: 'No se pudo consultar SAP en este momento. Puede escribir el producto y el lote a mano.' }, 502);
    }
    return errorResponse(error, 'sap-op');
  }
}
