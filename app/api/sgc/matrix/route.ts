import { prisma } from '@/lib/prisma';
import { addMatrixEntry, listMatrix, suggestForTarget } from '@/lib/sgc/db/matrix';
import { companyAccess, configAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/matrix?company=3 — matriz de responsables (consulta).
 *   Con &process=<id>&documentType=<id> devuelve la SUGERENCIA por rol.
 * POST /api/sgc/matrix — agrega una fila (administración de flujos o Calidad), con `reason`.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    const sp = new URL(request.url).searchParams;
    if (sp.has('process') || sp.has('documentType')) {
      const suggestion = await suggestForTarget(prisma, idCompany, { idProcess: Number(sp.get('process')) || null, idDocumentType: Number(sp.get('documentType')) || null });
      return jsonNoStore({ suggestion });
    }
    return jsonNoStore({ matrix: await listMatrix(prisma, idCompany, sp.get('inactivos') === '1') });
  } catch (error) {
    return errorResponse(error, 'matrix');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const idCompany = Number(body.company);
    if (!configAccess(ctx, idCompany)) return jsonNoStore({ error: 'Solo la administración de flujos o Calidad editan la matriz' }, 403);
    return jsonNoStore(await addMatrixEntry(prisma, idCompany, body as never, ctx.actor), 201);
  } catch (error) {
    return errorResponse(error, 'matrix:agregar');
  }
}
