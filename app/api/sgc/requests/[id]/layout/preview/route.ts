import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildLayoutPreview } from '@/lib/sgc/db/layout';
import { downloadSgcFile } from '@/lib/sgc/onedrive';
import { docxToHtml, htmlToPdf } from '@/lib/sgc/pdf/render';
import { NO_STORE, errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/sgc/requests/<id>/layout/preview — VISTA PREVIA del documento final
 * (sin firmas) sobre la que el elaborador ubica las firmas: el borrador vigente
 * compuesto como quedará en el PDF controlado (campos de sistema, historial de
 * cambios y encabezado institucional si aplica). Solo para quien participa en
 * la solicitud o Calidad; se muestra en línea (sin descarga).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud inválida' }, 400);
    const pdf = await buildLayoutPreview(prisma, { download: downloadSgcFile, htmlToPdf, docxToHtml }, id, { email: ctx.email, access: ctx.access });
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="vista-previa-SOL-${id}.pdf"`, 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return errorResponse(error, 'requests:composicion:vista-previa');
  }
}
