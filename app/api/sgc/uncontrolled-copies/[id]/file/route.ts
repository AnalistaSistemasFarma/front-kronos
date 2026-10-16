import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { consumeUncontrolledCopy } from '../../../../../../lib/sgc/db/uncontrolledCopies';
import { downloadVerifiedPdf } from '../../../../../../lib/sgc/onedrive';
import { stampUncontrolledCopy } from '../../../../../../lib/sgc/watermark';
import { NO_STORE, errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/uncontrolled-copies/<id>/file?modo=impresion|descarga — la
 * COPIA NO CONTROLADA autorizada y vigente de la persona, estampada con
 * «COPIA NO CONTROLADA», quién la pidió, quién la autorizó y su vencimiento.
 * «impresion» sale en línea (el navegador la imprime); «descarga» solo si la
 * copia es para un tercero. Cada uso queda como evento y en la auditoría.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Copia inválida' }, 400);
    const mode = new URL(request.url).searchParams.get('modo') === 'descarga' ? 'descarga' : 'impresion';
    const copy = await consumeUncontrolledCopy(prisma, id, mode, ctx.actor);
    const original = await downloadVerifiedPdf(copy.pdfItemId, copy.pdfSha256);
    const stamped = await stampUncontrolledCopy(original, { code: copy.code, versionNumber: copy.versionNumber, requesterEmail: copy.requesterEmail, authorizedBy: copy.authorizedBy, authorizedAt: copy.authorizedAt, expiresAt: copy.expiresAt, at: new Date(), mode, destination: copy.destination, ip: ctx.actor.ip });
    const fileName = `${copy.code} V${copy.versionNumber} - COPIA NO CONTROLADA.pdf`;
    return new NextResponse(Buffer.from(stamped), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${mode === 'descarga' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    return errorResponse(error, 'copias:archivo');
  }
}
