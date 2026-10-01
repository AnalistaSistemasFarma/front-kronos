import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { openReadingFile } from '@/lib/sgc/db/dissemination';
import { downloadVerifiedPdf } from '@/lib/sgc/onedrive';
import { stampControlledCopy } from '@/lib/sgc/watermark';
import { NO_STORE, errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/reading/<idCupo>/file — PDF CONTROLADO que la persona debe
 * leer en la divulgación, verificado contra su SHA-256 y estampado («en
 * divulgación — aún no vigente», con su correo y la hora). Solo la persona
 * asignada; registra la apertura (primera vez = «abrió»). Sin descarga.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const file = await openReadingFile(prisma, id, { email: ctx.email, access: ctx.access }, ctx.actor);
    const original = await downloadVerifiedPdf(file.itemId, file.sha256);
    const stamped = await stampControlledCopy(original, { code: file.code, versionNumber: file.versionNumber, viewerEmail: ctx.email, at: new Date(), mode: 'consulta', state: file.state });
    return new NextResponse(Buffer.from(stamped), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(`${file.code} V${file.versionNumber} - lectura.pdf`)}`,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    return errorResponse(error, 'lectura:archivo');
  }
}
