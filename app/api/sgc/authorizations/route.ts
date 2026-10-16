import { prisma } from '@/lib/prisma';
import { listAuthorizationInbox } from '@/lib/sgc/db/authorizations';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/** GET /api/sgc/authorizations[?company=3][&status=pendiente|autorizada|rechazada|anulada|todas] — bandeja Autorizaciones SGC. */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const status = new URL(request.url).searchParams.get('status');
    const rows = await listAuthorizationInbox(prisma, ctx.email, ctx.access, { status, idCompany: parseCompanyParam(request.url) });
    return jsonNoStore({ authorizations: rows });
  } catch (error) {
    return errorResponse(error, 'authorizations');
  }
}
