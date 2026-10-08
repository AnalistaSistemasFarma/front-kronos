import { prisma } from '../../../../lib/prisma';
import { confirmMasterListImport, getMasterListImportRows, listMasterListImports, previewMasterListImport } from '../../../../lib/sgc/db/masterListImport';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * LISTADO MAESTRO (Excel) — Sprint 8, solo Aseguramiento de Calidad.
 *
 * GET  /api/sgc/master-list?company=<id>              historial de importaciones
 * GET  /api/sgc/master-list?company=<id>&import=<id>  filas de una importación
 * POST { company, fileName, rows, confirm?, expectedSha256? }
 *      sin confirm → VISTA PREVIA (valida, no guarda nada)
 *      confirm: true → CARGA (201): documentos «pendientes de archivo» de las
 *      filas sin error e historial de la importación con todas las filas.
 * El navegador lee el Excel (misma mecánica del cargue masivo de SynerLink) y
 * envía las filas; el servidor valida TODO de nuevo.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad carga el listado maestro' }, 403);
    const raw = new URL(request.url).searchParams.get('import');
    if (raw) {
      const id = Number(raw);
      if (!Number.isInteger(id) || id < 1) return jsonNoStore({ error: 'Importación inválida' }, 400);
      return jsonNoStore({ rows: await getMasterListImportRows(prisma, idCompany, id) });
    }
    return jsonNoStore({ imports: await listMasterListImports(prisma, idCompany) });
  } catch (error) {
    return errorResponse(error, 'listado-maestro');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad carga el listado maestro' }, 403);
    if (body.confirm === true) return jsonNoStore(await confirmMasterListImport(prisma, idCompany, body, ctx.actor), 201);
    return jsonNoStore(await previewMasterListImport(prisma, idCompany, body));
  } catch (error) {
    return errorResponse(error, 'listado-maestro:carga');
  }
}
