import { prisma } from '../../../../../../../../lib/prisma';
import { verifyDocumentVersion } from '../../../../../../../../lib/sgc/db/signatures';
import { downloadSgcFile } from '../../../../../../../../lib/sgc/onedrive';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '../../../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/documents/<id>/versions/<versionId>/verify — verifica el PDF
 * controlado: huella SHA-256 del archivo contra la registrada, manifiesto de
 * firmas incrustado contra el guardado y cada firma contra sgc.signature
 * (registro íntegro, mismo contenido). La verificación queda en auditoría.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const p = await params;
    const id = parseId(p.id);
    const versionId = parseId(p.versionId);
    if (!id || !versionId) return jsonNoStore({ error: 'Petición inválida' }, 400);
    return jsonNoStore(await verifyDocumentVersion(prisma, { download: downloadSgcFile }, ctx.access, ctx.subject, id, versionId, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'documents:verificar');
  }
}
