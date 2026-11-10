import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { pdfRegistro } from '../../../../../../lib/biomedica/db';
import { downloadVerifiedFile, downloadVerifiedPdf } from '../../../../../../lib/sgc/onedrive';
import { NO_STORE, errorResponse, jsonNoStore, parseId, rateLimitResponse } from '../../../../sgc/_lib/context';
import { biomedContext } from '../../../_acceso';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/biomedica/registros/<id>/pdf?company=&vacio=1 — el formato (vacío, para el editor) o
 * diligenciado, con la marca de copia controlada. Se muestra EN LÍNEA en el visor de la app, nunca
 * como descarga (el permiso de descarga por persona es de la fase 2).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url);
    const c = await biomedContext(request, url.searchParams.get('company'));
    if (c instanceof Response) return c;
    const limited = rateLimitResponse('archivo', c.email);
    if (limited) return limited;
    if (['document', 'iframe', 'embed', 'object'].includes(request.headers.get('sec-fetch-dest') ?? '')) {
      return jsonNoStore({ error: 'Este archivo solo es visible en la app' }, 415);
    }
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Registro inválido' }, 400);
    const pdf = await pdfRegistro(prisma, c.access, id, { vacio: url.searchParams.get('vacio') === '1', viewerEmail: c.email }, { downloadVerifiedPdf, downloadVerifiedFile }, c.actor);
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="registro-${id}.pdf"`, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' },
    });
  } catch (error) {
    return errorResponse(error, 'biomedica:registro:pdf');
  }
}
