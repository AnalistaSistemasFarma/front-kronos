import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { inspectBulkExcel, previewBulkExcel } from '../../../../../../lib/sgc/db/bulkUpload';
import { sgcOfficeConverter } from '../../../../../../lib/sgc/onedrive';
import { docxToHtml, htmlToPdf } from '../../../../../../lib/sgc/pdf/render';
import { NO_STORE, companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, rateLimitResponse, uploadGuard } from '../../../_lib/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/sgc/master-list/files/preview (multipart: company, file, action,
 * settings) — 2026-10-21, solo Calidad y con la carga inicial abierta. Un
 * Excel (.xlsx) de la carga inicial, SIN guardarlo:
 *   - action=inspeccionar  → sus hojas, rango, columnas y primeras filas (JSON);
 *   - action=previsualizar → el PDF que saldría con esos ajustes de
 *     presentación, con la marca «VISTA PREVIA», para el visor seguro (inline,
 *     nunca como descarga).
 */
export async function POST(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const guard = uploadGuard(request, ctx);
    if (guard) return guard;
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const form = await request.formData().catch(() => null);
    if (!form) return jsonNoStore({ error: 'Se esperaba un formulario con el archivo' }, 400);
    const idCompany = Number(form.get('company'));
    if (!Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany, 'canQuality')) return jsonNoStore({ error: 'Solo Aseguramiento de Calidad carga los archivos del listado' }, 403);
    const file = form.get('file');
    if (!(file instanceof File)) return jsonNoStore({ error: 'Falta el archivo' }, 400);
    const payload = { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    const action = form.get('action');
    if (action === 'inspeccionar') return jsonNoStore(await inspectBulkExcel(prisma, idCompany, payload));
    if (action !== 'previsualizar') return jsonNoStore({ error: 'Acción inválida' }, 400);
    const pdf = await previewBulkExcel(prisma, idCompany, payload, form.get('settings'), ctx.actor, { docxToHtml, htmlToPdf, officeToPdf: sgcOfficeConverter.bytes });
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name.replace(/\.[^.]+$/, '') + ' (vista previa).pdf')}`,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    return errorResponse(error, 'listado-maestro:vista-previa-excel');
  }
}
