import { prisma } from '@/lib/prisma';
import { companyOfRequest, setSigners } from '@/lib/sgc/db/requests';
import { sgcNotifier } from '@/lib/sgc/notifications';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/requests/<id>/signers — { stepKey, signers: [correo…] (en su
 * orden), mode: 'orden' | 'paralelo', reason } — solo ASEGURAMIENTO DE CALIDAD
 * (permiso de Calidad o grupo de la radicación), nunca quien solicita o elabora
 * (2026-10-05). Un cambio (no la asignación inicial) exige motivo; todo queda
 * en el historial y en la auditoría.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, await companyOfRequest(prisma, id));
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    return jsonNoStore(await setSigners(prisma, sgcNotifier, id, body as never, ctx.actor, access));
  } catch (error) {
    return errorResponse(error, 'requests:firmantes');
  }
}
