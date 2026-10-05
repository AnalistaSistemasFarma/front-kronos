import { prisma } from '../../../../lib/prisma';
import { listGeneratorDocuments } from '../../../../lib/sgc/db/generator';
import { canUseSgcGenerator } from '../../../../lib/sgc/generator';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/generator?company=<id> — Generador de documentos: vigentes que
 * la persona puede consultar, con el formato de su contenido editable. Solo
 * gestión documental o Aseguramiento de Calidad.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    if (!canUseSgcGenerator(access)) return jsonNoStore({ error: 'El generador de documentos es para gestión documental o Aseguramiento de Calidad.' }, 403);
    return jsonNoStore({ documents: await listGeneratorDocuments(prisma, access, ctx.subject) });
  } catch (error) {
    return errorResponse(error, 'generador:listado');
  }
}
