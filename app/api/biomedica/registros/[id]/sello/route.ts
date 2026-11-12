import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { addSello, getSello } from '../../../../../../lib/biomedica/db';
import { SEAL_MAX_BYTES } from '../../../../../../lib/orion/annotations';
import { downloadVerifiedFile, uploadToSgcStorage } from '../../../../../../lib/sgc/onedrive';
import { errorResponse, jsonNoStore, parseId } from '../../../../sgc/_lib/context';
import { biomedContext } from '../../../_acceso';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Sellos del registro (el «Texto y sellos» de Orion, 2026-11-06).
 * GET ?company=&itemId= — la imagen de un sello DEL registro (para dibujarlo en el editor).
 * POST multipart company, file (PNG/JPG, máx. 2 MB) → { sealItemId, sealFileName }.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url);
    const c = await biomedContext(request, url.searchParams.get('company'));
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    const itemId = String(url.searchParams.get('itemId') || '').trim();
    if (!id || !itemId) return jsonNoStore({ error: 'Registro y sello son obligatorios' }, 400);
    const sello = await getSello(prisma, c.access, id, itemId, { downloadVerifiedFile });
    return new NextResponse(Buffer.from(sello.bytes), {
      status: 200,
      headers: { 'Content-Type': sello.mime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return errorResponse(error, 'biomedica:sello');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (Number(request.headers.get('content-length') || 0) > SEAL_MAX_BYTES + 64 * 1024) {
      return jsonNoStore({ error: 'La imagen del sello debe pesar máximo 2 MB.' }, 413);
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const c = await biomedContext(request, form?.get('company'));
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    if (!id || !(file instanceof Blob)) return jsonNoStore({ error: 'Registro e imagen son obligatorios' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file instanceof File ? file.name.slice(0, 120) : 'sello';
    return jsonNoStore(await addSello(prisma, c.access, id, { bytes, fileName: name }, c.actor, { upload: uploadToSgcStorage }));
  } catch (error) {
    return errorResponse(error, 'biomedica:sello:cargar');
  }
}
