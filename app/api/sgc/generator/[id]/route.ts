import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../../../../../lib/sgc/audit';
import { generateFromVigente, getGeneratorBase } from '../../../../../lib/sgc/db/generator';
import { parseGeneratorMode } from '../../../../../lib/sgc/generator';
import { downloadSgcFile } from '../../../../../lib/sgc/onedrive';
import { docxToHtml, htmlToPdf } from '../../../../../lib/sgc/pdf/render';
import { NO_STORE, errorResponse, getSgcRequestContext, jsonNoStore, parseId, rateLimitResponse, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgc/generator/<idDocumento> — contenido VIGENTE del documento como
 * HTML para abrirlo en el editor como COPIA DE TRABAJO (no toca el documento
 * controlado, no crea versión ni solicitud).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    if (ctx.access.length === 0) return jsonNoStore({ error: 'Sin acceso al SGC' }, 403);
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Documento inválido' }, 400);
    return jsonNoStore(await getGeneratorBase(prisma, { download: downloadSgcFile, docxToHtml }, ctx.access, ctx.subject, id));
  } catch (error) {
    return errorResponse(error, 'generador:base');
  }
}

/**
 * POST /api/sgc/generator/<idDocumento> { html, modo: 'vista' | 'descarga' }
 * Genera el PDF de la copia de trabajo con el encabezado del documento de
 * origen y la leyenda de trazabilidad. Es efímero: no se guarda. `vista` sale
 * inline (para el visor) y `descarga` como adjunto: es el ÚNICO caso del SGC
 * en que se descarga, porque es la versión modificada generada desde la
 * plataforma, no el documento controlado. Las dos quedan en la auditoría.
 * No pide motivo de cambio: no es un cambio del documento.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    if (ctx.access.length === 0) return jsonNoStore({ error: 'Sin acceso al SGC' }, 403);
    const limited = rateLimitResponse('archivo', ctx.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Documento inválido' }, 400);
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Cuerpo inválido' }, 400);
    const mode = parseGeneratorMode(body.modo ?? 'vista');
    if (!mode) return jsonNoStore({ error: 'Modo inválido' }, 400);

    const out = await generateFromVigente(prisma, { docxToHtml, htmlToPdf }, ctx.access, ctx.subject, id, { html: body.html });
    await writeSgcAudit(prisma, {
      idCompany: out.document.idCompany,
      actorEmail: ctx.email,
      action: mode === 'descarga' ? SGC_AUDIT_ACTIONS.generadorDescarga : SGC_AUDIT_ACTIONS.generadorDocumento,
      entity: 'document_version',
      entityId: out.document.idVersion,
      detail: `${mode === 'descarga' ? 'Descarga del documento generado' : 'Documento generado'} a partir de ${out.document.code} V${out.document.versionNumber} (${out.bytes.length} bytes).`,
      ip: ctx.actor.ip,
      userAgent: ctx.actor.userAgent,
    });
    return new NextResponse(Buffer.from(out.bytes), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${mode === 'descarga' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(out.fileName)}`,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    return errorResponse(error, 'generador:generar');
  }
}
