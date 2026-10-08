import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getAttachmentForDownload } from '@/lib/sgc/db/requests';
import { downloadVerifiedFile } from '@/lib/sgc/onedrive';
import { NO_STORE, errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/requests/<id>/attachments/<attachmentId> — descarga un adjunto
 * de la solicitud (borrador en elaboración o soporte; NO es un documento
 * controlado vigente), tras verificar su SHA-256. Queda en la auditoría.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const p = await params;
    const id = parseId(p.id);
    const attachmentId = parseId(p.attachmentId);
    if (!id || !attachmentId) return jsonNoStore({ error: 'Adjunto no encontrado' }, 404);
    const att = await getAttachmentForDownload(prisma, id, attachmentId, { email: ctx.email, access: ctx.access }, ctx.actor);
    const bytes = await downloadVerifiedFile(att.itemId, att.sha256);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': att.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error, 'requests:descarga');
  }
}
