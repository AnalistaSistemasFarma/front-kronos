import { prisma } from '@/lib/prisma';
import { companyOfRequest, isPostApprovalStep } from '@/lib/sgc/db/requests';
import { generateControlledVersion } from '@/lib/sgc/db/signatures';
import { sgcSignatureDeps } from '@/lib/sgc/signature/deps';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/requests/<id>/controlled-pdf — REINTENTA generar el PDF
 * controlado de una solicitud aprobada (si falló al cerrar la Aprobación).
 * Solo Calidad. Idempotente: si ya existe, devuelve la versión generada.
 * Vale con la solicitud en espera o completada, o abierta en un paso posterior
 * a la aprobación (preparación de la capacitación, divulgación o capacitación).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud inválida' }, 400);
    const idCompany = await companyOfRequest(prisma, id);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad genera el PDF controlado' }, 403);
    const req = await prisma.sgcRequest.findUniqueOrThrow({ where: { id_request: id }, select: { status: true, current_task_key: true, id_flow_version: true } });
    // E2E 2026-10-10: desde el S4/S10 la solicitud aprobada sigue ABIERTA (preparación de la
    // capacitación, divulgación, capacitación): el reintento también vale en esos pasos.
    const approved = req.status === 'en_espera' || req.status === 'completada' || (req.status === 'abierta' && (await isPostApprovalStep(prisma, req.id_flow_version, req.current_task_key)));
    if (!approved) return jsonNoStore({ error: 'La solicitud aún no está aprobada' }, 409);
    return jsonNoStore(await generateControlledVersion(prisma, sgcSignatureDeps(), id, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'requests:pdf-controlado');
  }
}
