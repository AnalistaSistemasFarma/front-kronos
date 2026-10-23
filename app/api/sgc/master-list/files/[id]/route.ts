import { prisma } from '../../../../../../lib/prisma';
import { uploadBulkFile } from '../../../../../../lib/sgc/db/bulkUpload';
import { normalizeSheetSettings } from '../../../../../../lib/sgc/sheetSettings';
import { sgcOfficeConverter, uploadToSgcStorage } from '../../../../../../lib/sgc/onedrive';
import { docxToHtml, htmlToPdf } from '../../../../../../lib/sgc/pdf/render';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, uploadGuard } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/master-list/files/<idBulkUpload> (multipart: company, file) —
 * carga UN archivo de la tanda (Sprint 9, solo Calidad): PDF o, desde el S16
 * (R33), el original en Word (.docx) o Excel (.xlsx), que se convierte a PDF
 * para el visor y se conserva con su huella. Responde 201 con el
 * resultado del archivo, cargado o con su error (un error de negocio no corta
 * la tanda: queda registrado y el navegador sigue con el siguiente).
 * 2026-10-21: un Excel puede traer `settings` (ajustes de presentación que
 * Calidad previsualizó); sin ellos, el ajuste automático.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const guard = uploadGuard(request, ctx);
    if (guard) return guard;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Carga inválida' }, 400);
    const form = await request.formData().catch(() => null);
    if (!form) return jsonNoStore({ error: 'Se esperaba un formulario con el archivo' }, 400);
    const idCompany = Number(form.get('company'));
    if (!Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad carga los archivos del listado' }, 403);
    const file = form.get('file');
    if (!(file instanceof File)) return jsonNoStore({ error: 'Falta el archivo' }, 400);
    const settings = form.get('settings') ? normalizeSheetSettings(form.get('settings')) : null;
    const result = await uploadBulkFile(prisma, uploadToSgcStorage, idCompany, id, { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, ctx.actor, new Date(), { docxToHtml, htmlToPdf, officeToPdf: sgcOfficeConverter.bytes }, settings);
    return jsonNoStore(result, 201);
  } catch (error) {
    return errorResponse(error, 'listado-maestro:archivo');
  }
}
