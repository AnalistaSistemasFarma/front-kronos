import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getAttachmentForDownload } from '@/lib/sgc/db/requests';
import { buildLayoutPreview } from '@/lib/sgc/db/layout';
import { currentDraftInTx } from '@/lib/sgc/db/signatureRecord';
import { downloadSgcFile, downloadVerifiedFile } from '@/lib/sgc/onedrive';
import { docxToHtml, htmlToPdf } from '@/lib/sgc/pdf/render';
import { attachmentToViewablePdf } from '@/lib/sgc/pdf/viewable';
import { NO_STORE, errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/sgc/requests/<id>/attachments/<attachmentId> — entrega un adjunto
 * de la solicitud para VERLO en el visor seguro de la app, nunca como descarga
 * (RN de auditoría del SGC, 2026-10-05), tras verificar su SHA-256:
 *   - el borrador VIGENTE (Word o PDF) sale compuesto como la vista previa del
 *     documento final, con el encabezado del SGC (código, versión, título…);
 *   - los demás: PDF tal cual, Word (.docx) y Excel (.xlsx) convertidos a PDF;
 *     cualquier otro formato responde 415.
 * Cada apertura queda en la auditoría (consulta).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    // Abrir la URL directo en el navegador (pestaña, iframe) mostraría el visor nativo, que trae «Descargar».
    if (['document', 'iframe', 'embed', 'object'].includes(request.headers.get('sec-fetch-dest') ?? '')) {
      return jsonNoStore({ error: 'Este archivo solo es visible en la app' }, 415);
    }
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const p = await params;
    const id = parseId(p.id);
    const attachmentId = parseId(p.attachmentId);
    if (!id || !attachmentId) return jsonNoStore({ error: 'Adjunto no encontrado' }, 404);
    const viewer = { email: ctx.email, access: ctx.access };
    const att = await getAttachmentForDownload(prisma, id, attachmentId, viewer, ctx.actor);
    const draft = att.purpose === 'borrador' ? await currentDraftInTx(prisma as never, id) : null;
    let pdf: Uint8Array | null;
    if (draft && draft.ref === `adjunto:${attachmentId}` && draft.format !== 'doc') {
      pdf = await buildLayoutPreview(prisma, { download: downloadSgcFile, htmlToPdf, docxToHtml }, id, viewer, { runningHeader: true });
    } else {
      const bytes = await downloadVerifiedFile(att.itemId, att.sha256);
      pdf = await attachmentToViewablePdf(bytes, att.fileName, { docxToHtml, htmlToPdf });
    }
    if (!pdf) return jsonNoStore({ error: 'Este archivo solo es visible en la app' }, 415);
    const fileName = att.fileName.replace(/\.[^.]+$/, '') + '.pdf';
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    return errorResponse(error, 'requests:visualizacion');
  }
}
