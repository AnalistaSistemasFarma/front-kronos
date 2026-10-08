import { prisma } from '@/lib/prisma';
import { listTaskInbox } from '@/lib/sgc/db/requests';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/tasks[?company=3][&status=abierta|sin_empezar|resuelta|cancelada|en_espera][&request=<id>] — bandeja «Tareas documentales». */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const sp = new URL(request.url).searchParams;
    const tasks = await listTaskInbox(prisma, ctx.email, ctx.access, { status: sp.get('status'), idCompany: parseCompanyParam(request.url), idRequest: Number(sp.get('request')) || null });
    return jsonNoStore({ tasks });
  } catch (error) {
    return errorResponse(error, 'tasks');
  }
}
