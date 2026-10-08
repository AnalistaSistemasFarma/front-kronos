import { prisma } from '@/lib/prisma';
import { createRequest, listMyRequests } from '@/lib/sgc/db/requests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/requests[?company=3] — solicitudes documentales que la persona
 * creó o elabora (Calidad: todas las de la empresa).
 * POST /api/sgc/requests — crea una solicitud documental (gestión o Calidad):
 * { company, requestType, subject, description, idDocument? | idProcess + idDocumentType,
 *   formValues? }. Un elaboratorEmail que llegue se IGNORA (2026-10-05): el
 * elaborador lo asigna el servidor según la configuración del proceso.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    return jsonNoStore({ requests: await listMyRequests(prisma, ctx.email, ctx.access, { idCompany: parseCompanyParam(request.url) }) });
  } catch (error) {
    return errorResponse(error, 'requests');
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const idCompany = Number(body.company);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    const created = await createRequest(
      prisma,
      sgcNotifier,
      access,
      {
        idCompany,
        requestType: body.requestType,
        subject: body.subject,
        description: body.description,
        idDocument: body.idDocument,
        idProcess: body.idProcess,
        idDocumentType: body.idDocumentType,
        idParentDocument: body.idParentDocument,
        elaboratorEmail: body.elaboratorEmail,
        formValues: body.formValues && typeof body.formValues === 'object' ? (body.formValues as Record<string, unknown>) : {},
      },
      ctx.actor
    );
    return jsonNoStore(created, 201);
  } catch (error) {
    return errorResponse(error, 'requests:crear');
  }
}
