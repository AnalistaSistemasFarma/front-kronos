import { prisma } from '@/lib/prisma';
import { listConfigChanges } from '@/lib/sgc/db/flows';
import { configAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/flows/changes?company=3[&process=<id>][&entity=...] — registro de cambios de configuración. */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!configAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin permiso de administración de flujos' }, 403);
    const sp = new URL(request.url).searchParams;
    const changes = await listConfigChanges(prisma, idCompany, { idFlowProcess: Number(sp.get('process')) || null, entity: sp.get('entity') });
    return jsonNoStore({ changes });
  } catch (error) {
    return errorResponse(error, 'flows:cambios');
  }
}
