import { prisma } from '@/lib/prisma';
import { uploadAttachment } from '@/lib/sgc/db/requests';
import { uploadToSgcStorage } from '@/lib/sgc/onedrive';
import { errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/requests/<id>/attachments (multipart) — file, purpose
 * (borrador = documento en elaboración, solo el elaborador; soporte). Va a
 * la carpeta propia SGC/<EMPRESA>/_solicitudes/SOL-<id>/ con su SHA-256.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!id || !form || !(file instanceof File)) return jsonNoStore({ error: 'Se esperaba un archivo' }, 400);
    const result = await uploadAttachment(
      prisma,
      uploadToSgcStorage,
      id,
      { purpose: form.get('purpose'), fileName: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
      { email: ctx.email, access: ctx.access },
      ctx.actor
    );
    return jsonNoStore(result, 201);
  } catch (error) {
    return errorResponse(error, 'requests:adjunto');
  }
}
