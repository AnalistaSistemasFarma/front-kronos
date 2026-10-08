import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { auditReportToCsv, getDocumentAuditReport } from '../../../../../../lib/sgc/db/auditReport';
import { NO_STORE, errorResponse, getSgcRequestContext, jsonNoStore, parseId } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/documents/<id>/audit[?formato=csv] — REPORTE DE AUDITORÍA del
 * documento (Calidad): eventos de sgc.audit_log, solicitudes, firmas con su
 * verificación de integridad y la cadena de firmas de la empresa.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Documento inválido' }, 400);
    const report = await getDocumentAuditReport(prisma, ctx.access, id, ctx.actor);
    if (new URL(request.url).searchParams.get('formato') === 'csv') {
      return new NextResponse(auditReportToCsv(report), {
        status: 200,
        headers: { ...NO_STORE, 'Content-Type': 'text/csv; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`auditoria-${report.document.code}.csv`)}` },
      });
    }
    return jsonNoStore(report);
  } catch (error) {
    return errorResponse(error, 'documents:auditoria');
  }
}
