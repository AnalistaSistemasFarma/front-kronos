import { prisma } from '@/lib/prisma';
import { companyOfRequest, setTrainingFlag } from '@/lib/sgc/db/requests';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/sgc/requests/<id>/training-flag { requiresTraining: true|false, reason? }
 * — Sprint 10: CONFIRMA si la solicitud requiere capacitación (quien crea el
 * documento o Calidad; el solicitante solo la sugiere al crearla). No se cambia
 * después de que empieza la preparación del material o la divulgación.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const idCompany = await companyOfRequest(prisma, id);
    const access = ctx.access.find((a) => a.idCompany === idCompany) ?? null;
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    return jsonNoStore(await setTrainingFlag(prisma, id, body, ctx.actor, access));
  } catch (error) {
    return errorResponse(error, 'requests:capacitacion-bandera');
  }
}
