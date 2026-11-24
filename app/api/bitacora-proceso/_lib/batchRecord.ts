import { prisma } from '../../../../lib/prisma';
import { getOrdenDetalle } from '../../../../lib/bitacora-proceso/db';
import { assertMismoLote, buildBatchRecordXlsx, nombreArchivoBatchRecord, parseBatchRecordInput } from '../../../../lib/bitacora-proceso/batchRecord';
import { OtError } from '../../../../lib/bitacora-proceso/rules';
import { getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from './context';

/**
 * Arma el .xlsx con el encabezado confirmado y las bitácoras elegidas (todas del mismo lote y de la
 * empresa). Lo usan la descarga y la vista previa, para que la vista previa sea EXACTAMENTE el archivo.
 */
export async function armarBatchRecord(request: Request, params: Promise<{ id: string }>) {
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
  return { xlsx, nombre: nombreArchivoBatchRecord(ordenes[0].lote, ordenes.map((o) => o.consecutivo)) };
}

