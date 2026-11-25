import { prisma } from '../../../../../lib/prisma';
import { getOrdenDetalle, listOrdenesDelLote } from '../../../../../lib/bitacora-proceso/db';
import { buscarOpsPorLote, leerOpBatchRecord } from '../../../../../lib/bitacora-proceso/sap';
import { elegirOpBatchRecord, sugerirConcentracion, sugerirLoteMp } from '../../../../../lib/bitacora-proceso/batchRecord';
import { armarBatchRecord } from '../../_lib/batchRecord';
import { errorResponse, getOtRequestContext, jsonNoStore, NO_STORE, parseCompanyParam, parseId, requireCompany } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bitacora-proceso/[id]/batch-record?company=1 — vista previa del Excel del batch record
 * (2026-11-24): encabezado SUGERIDO (producto, concentración, lote, OP y lote de materia prima,
 * desde la bitácora y la OP de SAP, solo lectura) y las bitácoras del mismo lote para juntarlas.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Bitácora no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const orden = await getOrdenDetalle(prisma, id, access, ctx.actor.idUser);
    if (!orden) return jsonNoStore({ error: 'Bitácora no encontrada' }, 404);
    const delLote = await listOrdenesDelLote(prisma, access.idCompany, orden.lote);
    // OP: la de la bitácora, la de otra del mismo lote o la de SAP por el lote (2026-11-25).
    const absBase = Number(orden.sapOp?.AbsoluteEntry);
    const base = { sapOpDocNum: orden.sapOpDocNum, sapOpAbsEntry: Number.isInteger(absBase) && absBase > 0 ? absBase : null, itemCode: orden.itemCode };
    const necesitaSap = !base.sapOpDocNum && !delLote.some((b) => b.sapOpDocNum);
    const porLote = necesitaSap ? await buscarOpsPorLote(access.idCompany, orden.lote) : null;
    const elegida = elegirOpBatchRecord(base, delLote, porLote);
    const sap = elegida.absEntry ? await leerOpBatchRecord(access.idCompany, elegida.absEntry) : null;
    const producto = orden.producto;
    const encabezado = {
      producto,
      concentracion: sugerirConcentracion(sap?.ProductDescription ?? producto) || sugerirConcentracion(producto),
      lote: orden.lote,
      op: elegida.op,
      loteMp: sugerirLoteMp(sap?.Remarks),
    };
    return jsonNoStore({ encabezado, opOrigen: elegida.origen, sapConsultado: sap !== null, bitacoras: delLote });
  } catch (error) {
    return errorResponse(error, 'batch-record');
  }
}

/** POST /api/bitacora-proceso/[id]/batch-record?company=1 — descarga el .xlsx (después de la vista previa). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const r = await armarBatchRecord(request, params);
    if (r instanceof Response) return r;
    return new Response(new Uint8Array(r.xlsx), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${r.nombre}"`,
      },
    });
  } catch (error) {
    return errorResponse(error, 'batch-record');
  }
}
