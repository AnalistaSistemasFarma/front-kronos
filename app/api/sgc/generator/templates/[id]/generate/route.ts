import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { generateFromTemplate } from '../../../../../../../lib/sgc/db/generator';
import { uploadToSgcStorage } from '../../../../../../../lib/sgc/onedrive';
import { htmlToPdf } from '../../../../../../../lib/sgc/pdf/render';
import { NO_STORE, companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse, readJson } from '../../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sgc/generator/templates/<id>/generate { company, modo: 'vista' | 'emitir', values }
 * `vista`: PDF efímero «VISTA PREVIA» en línea para el visor (no se guarda);
 * `emitir`: crea el REGISTRO numerado y responde su código (se consulta en el visor).
 * Nunca responde como descarga (RN «Ver documento sin descarga»).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    const body = await readJson(request);
    const idCompany = Number(body?.company);
    if (!id || !body || !Number.isInteger(idCompany) || idCompany < 1) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const access = companyAccess(ctx, idCompany);
    if (!access) return jsonNoStore({ error: 'Sin acceso al SGC de la empresa' }, 403);
    const out = await generateFromTemplate(prisma, { htmlToPdf, upload: uploadToSgcStorage }, access, ctx.subject, id, body, ctx.actor);
    if (out.record) return jsonNoStore({ record: out.record }, 201);
    return new NextResponse(Buffer.from(out.bytes!), {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' },
    });
  } catch (error) {
    return errorResponse(error, 'generador:generar');
  }
}
