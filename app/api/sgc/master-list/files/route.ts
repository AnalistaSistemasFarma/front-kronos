import { prisma } from '../../../../../lib/prisma';
import { listBulkUploads, previewBulkUpload, startBulkUpload } from '../../../../../lib/sgc/db/bulkUpload';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * CARGA MASIVA DE LOS PDF del listado maestro (Sprint 9), solo Calidad.
 * GET  ?company=<id>                                  historial de cargas
 * POST { company, action: 'vista_previa', fileNames } con qué documento se empareja cada archivo (no guarda)
 * POST { company, action: 'iniciar', filesTotal }     abre la tanda (201) → idBulkUpload
 * Cada archivo se sube después a /api/sgc/master-list/files/<idBulkUpload>.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad carga los archivos del listado' }, 403);
    return jsonNoStore({ uploads: await listBulkUploads(prisma, idCompany) });
  } catch (error) {
    return errorResponse(error, 'listado-maestro:archivos');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad carga los archivos del listado' }, 403);
    if (body.action === 'iniciar') return jsonNoStore(await startBulkUpload(prisma, idCompany, body, ctx.actor), 201);
    if (body.action === 'vista_previa') return jsonNoStore({ files: await previewBulkUpload(prisma, idCompany, body) });
    return jsonNoStore({ error: 'Acción inválida' }, 400);
  } catch (error) {
    return errorResponse(error, 'listado-maestro:archivos');
  }
}
