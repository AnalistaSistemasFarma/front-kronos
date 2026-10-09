import { prisma } from '../../../../../../lib/prisma';
import { uploadBulkFile } from '../../../../../../lib/sgc/db/bulkUpload';
import { uploadToSgcStorage } from '../../../../../../lib/sgc/onedrive';
import { companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, uploadGuard } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/master-list/files/<idBulkUpload> (multipart: company, file) —
 * carga UN PDF de la tanda (Sprint 9, solo Calidad). Responde 201 con el
 * resultado del archivo, cargado o con su error (un error de negocio no corta
 * la tanda: queda registrado y el navegador sigue con el siguiente).
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
    const result = await uploadBulkFile(prisma, uploadToSgcStorage, idCompany, id, { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, ctx.actor);
    return jsonNoStore(result, 201);
  } catch (error) {
    return errorResponse(error, 'listado-maestro:archivo');
  }
}
