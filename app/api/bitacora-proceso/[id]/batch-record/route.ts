import { prisma } from '../../../../../lib/prisma';
import { getOrdenDetalle, listOrdenesDelLote } from '../../../../../lib/bitacora-proceso/db';
import { leerOpBatchRecord } from '../../../../../lib/bitacora-proceso/sap';
import {
  assertMismoLote,
  buildBatchRecordXlsx,
  nombreArchivoBatchRecord,
  parseBatchRecordInput,
  sugerirConcentracion,
  sugerirLoteMp,
} from '../../../../../lib/bitacora-proceso/batchRecord';
import { OtError } from '../../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, NO_STORE, parseCompanyParam, parseId, readJson, requireCompany } from '../../_lib/context';

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
    const abs = Number(orden.sapOp?.AbsoluteEntry);
    const sap = Number.isInteger(abs) && abs > 0 ? await leerOpBatchRecord(access.idCompany, abs) : null;
    const producto = orden.producto;
    const encabezado = {
      producto,
      concentracion: sugerirConcentracion(sap?.ProductDescription ?? producto) || sugerirConcentracion(producto),
      lote: orden.lote,
      op: orden.sapOpDocNum ? String(orden.sapOpDocNum) : '',
      loteMp: sugerirLoteMp(sap?.Remarks),
    };
    const delLote = await listOrdenesDelLote(prisma, access.idCompany, orden.lote);
    return jsonNoStore({ encabezado, sapConsultado: sap !== null, bitacoras: delLote });
  } catch (error) {
    return errorResponse(error, 'batch-record');
  }
}

/** POST /api/bitacora-proceso/[id]/batch-record?company=1 — descarga el .xlsx con el encabezado confirmado. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Bitácora no válida' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const input = parseBatchRecordInput(await readJson(request), id);
    const ordenes = [];
    for (const idOrden of input.ids) {
      const o = await getOrdenDetalle(prisma, idOrden, access, ctx.actor.idUser);
      if (!o) throw new OtError(`La bitácora ${idOrden} no existe en esta empresa.`, 404);
      ordenes.push(o);
    }
    assertMismoLote(ordenes);
    const xlsx = await buildBatchRecordXlsx(input, ordenes);
    const nombre = nombreArchivoBatchRecord(ordenes[0].lote, ordenes.map((o) => o.consecutivo));
    return new Response(new Uint8Array(xlsx), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nombre}"`,
      },
    });
  } catch (error) {
    return errorResponse(error, 'batch-record');
  }
}
