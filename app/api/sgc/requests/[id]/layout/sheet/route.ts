import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildLayoutPreview, inspectDraftSheets, saveDocumentLayout, validateDraftSheetSettings } from '@/lib/sgc/db/layout';
import { downloadSgcFile, sgcOfficeConverter } from '@/lib/sgc/onedrive';
import { docxToHtml, htmlToPdf } from '@/lib/sgc/pdf/render';
import { NO_STORE, errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse, readJson } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 2026-10-22: «Ajustar y previsualizar» el BORRADOR EN EXCEL de una solicitud
 * (documento nuevo o nueva versión). Solo la presentación: orientación,
 * tamaño, área de impresión, filas de título, columnas y hojas que salen; el
 * texto del Excel no cambia.
 *   GET  → hojas del borrador (rango, columnas, primeras filas) y los ajustes guardados.
 *   POST { action: 'previsualizar', settings } → vista previa del documento final con esos
 *        ajustes, SIN guardarlos (en línea, nunca como descarga).
 *   POST { action: 'guardar', settings, reason? } → los guarda con la composición (solo el
 *        elaborador, durante la elaboración; fila nueva, historial y auditoría). Si cambia la
 *        orientación, las firmas ubicadas se quitan para volver a ubicarlas.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Solicitud inválida' }, 400);
    return jsonNoStore(await inspectDraftSheets(prisma, { download: downloadSgcFile }, id, { email: ctx.email, access: ctx.access }));
  } catch (error) {
    return errorResponse(error, 'requests:excel:inspeccionar');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    const body = await readJson(request);
    if (!id || !body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const viewer = { email: ctx.email, access: ctx.access };
    const deps = { download: downloadSgcFile, htmlToPdf, docxToHtml, officeToPdf: sgcOfficeConverter.bytes };
    if (body.action !== 'previsualizar' && body.action !== 'guardar') return jsonNoStore({ error: 'Acción inválida' }, 400);
    const settings = await validateDraftSheetSettings(prisma, deps, id, viewer, body.settings ?? null);
    if (body.action === 'guardar') return jsonNoStore(await saveDocumentLayout(prisma, id, { sheetSettings: settings, reason: body.reason }, viewer, ctx.actor, deps));
    const pdf = await buildLayoutPreview(prisma, deps, id, viewer, { sheetSettings: settings });
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="vista-previa-SOL-${id}.pdf"`, 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return errorResponse(error, 'requests:excel:ajustes');
  }
}
