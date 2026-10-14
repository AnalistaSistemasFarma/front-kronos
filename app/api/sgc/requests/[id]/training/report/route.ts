import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAccessSubject, getVersionForViewer } from '@/lib/sgc/db/documents';
import { getTrainingReport } from '@/lib/sgc/db/evaluation';
import { companyOfRequest } from '@/lib/sgc/db/requests';
import { downloadVerifiedFile } from '@/lib/sgc/onedrive';
import { docxToHtml, htmlToPdf, wrapDraftForPdf } from '@/lib/sgc/pdf/render';
import { attachmentToViewablePdf } from '@/lib/sgc/pdf/viewable';
import { parseCsv } from '@/lib/sgc/training/xlsx';
import { NO_STORE, companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * GET /api/sgc/requests/<id>/training/report — REPORTE de resultados de la
 * capacitación (S18, R30) para el VISOR de la app (PDF en línea, nunca como
 * descarga). Con ?modo=descarga entrega el Excel original SOLO a quien tiene el
 * permiso excepcional de descarga del documento. Cada consulta queda en la auditoría.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    if (['document', 'iframe', 'embed', 'object'].includes(request.headers.get('sec-fetch-dest') ?? '')) return jsonNoStore({ error: 'Este reporte solo es visible en la app' }, 415);
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    const access = companyAccess(ctx, await companyOfRequest(prisma, id));
    if (!access) return jsonNoStore({ error: 'Solicitud no encontrada' }, 404);
    const report = await getTrainingReport(prisma, access, id, ctx.actor);
    const bytes = await downloadVerifiedFile(report.itemId, report.sha256);
    if (new URL(request.url).searchParams.get('modo') === 'descarga') {
      const found = report.idDocument && report.idDocumentVersion ? await getVersionForViewer(prisma, ctx.access, await getAccessSubject(prisma, ctx.email), report.idDocument, report.idDocumentVersion) : null;
      if (!found?.permissions.canDownload) return jsonNoStore({ error: 'La descarga requiere el permiso excepcional de descarga del documento.' }, 403);
      return new NextResponse(Buffer.from(bytes), {
        status: 200,
        headers: { ...NO_STORE, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(report.fileName)}`, 'X-Content-Type-Options': 'nosniff' },
      });
    }
    let pdf: Uint8Array | null;
    if (/\.csv$/i.test(report.fileName)) {
      const rows = parseCsv(new TextDecoder().decode(bytes)).slice(0, 2000);
      const html = `<table>${rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${escapeHtml(c)}</th>` : `<td>${escapeHtml(c)}</td>`)).join('')}</tr>`).join('')}</table>`;
      pdf = await htmlToPdf(wrapDraftForPdf({ title: report.fileName, code: '', contentHtml: html }));
    } else {
      pdf = await attachmentToViewablePdf(bytes, report.fileName, { docxToHtml, htmlToPdf });
    }
    if (!pdf) return jsonNoStore({ error: 'Este reporte solo es visible en la app' }, 415);
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(report.fileName.replace(/\.[^.]+$/, '') + '.pdf')}`, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' },
    });
  } catch (error) {
    return errorResponse(error, 'capacitacion:reporte');
  }
}
