import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../../../../../../../lib/sgc/audit';
import { isViewerProtected } from '../../../../../../../lib/sgc/db/companySettings';
import { getGeneratedForViewer } from '../../../../../../../lib/sgc/db/generator';
import { downloadVerifiedPdf } from '../../../../../../../lib/sgc/onedrive';
import { stampControlledCopy, type SgcWatermarkInfo } from '../../../../../../../lib/sgc/watermark';
import { NO_STORE, errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse } from '../../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/generator/documents/<id>/file — el REGISTRO generado para el
 * VISOR del SGC: verificado contra su SHA-256 y estampado con quién lo
 * consulta y cuándo (y en mosaico si la empresa protege el visor). Solo en
 * línea, NUNCA como descarga (RN «Ver documento sin descarga»). Lo ven quien
 * lo generó y Aseguramiento de Calidad; cada consulta queda en la auditoría.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    if (ctx.access.length === 0) return jsonNoStore({ error: 'Sin acceso al SGC' }, 403);
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Documento inválido' }, 400);
    const found = await getGeneratedForViewer(prisma, ctx.access, ctx.email, id);
    if (!found) {
      await writeSgcAudit(prisma, { idCompany: null, actorEmail: ctx.email, action: SGC_AUDIT_ACTIONS.accesoDenegado, entity: 'generated_document', entityId: id, detail: 'Intento de consulta de un documento generado sin permiso.', ip: ctx.actor.ip, userAgent: ctx.actor.userAgent });
      return jsonNoStore({ error: 'Documento no encontrado' }, 404);
    }
    const original = await downloadVerifiedPdf(found.pdfItemId, found.pdfSha256);
    const info: SgcWatermarkInfo = { code: found.code, versionNumber: 1, viewerEmail: ctx.email, at: new Date(), mode: 'consulta', state: found.status === 'anulado' ? 'anulado' : 'vigente' };
    const protect = await isViewerProtected(prisma, found.idCompany);
    if (protect) Object.assign(info, { tiled: true, ip: ctx.actor.ip ?? null });
    const stamped = await stampControlledCopy(original, info);
    await writeSgcAudit(prisma, { idCompany: found.idCompany, actorEmail: ctx.email, action: SGC_AUDIT_ACTIONS.documentoConsulta, entity: 'generated_document', entityId: found.idGenerated, detail: `${found.code} (consulta del registro generado).`, ip: ctx.actor.ip, userAgent: ctx.actor.userAgent });
    return new NextResponse(Buffer.from(stamped), {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'X-Sgc-Proteccion': protect ? '1' : '0' },
    });
  } catch (error) {
    return errorResponse(error, 'generador:archivo');
  }
}
