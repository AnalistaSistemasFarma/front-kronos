import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildHeaderTemplatePreview } from '@/lib/sgc/db/headerTemplates';
import { NO_STORE, companyAccess, errorResponse, getSgcRequestContext, jsonNoStore, parseCompanyParam } from '@/app/api/sgc/_lib/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/sgc/header-templates/preview?company=<id>&id=<plantilla> (o &config=<JSON en base64url>,
 * para la plantilla que se está editando) — VISTA PREVIA del encabezado (S16, R31) sobre dos páginas
 * de ejemplo, para mostrarla en la pantalla de Configuración (no es un documento: no se descarga).
 */
export async function GET(request: Request) {
  try {
    const ctx = await getSgcRequestContext(request);
    if (ctx instanceof Response) return ctx;
    if (['document', 'iframe', 'embed', 'object'].includes(request.headers.get('sec-fetch-dest') ?? '')) return jsonNoStore({ error: 'La vista previa solo es visible en la app' }, 415);
    const idCompany = parseCompanyParam(request.url);
    if (!idCompany) return jsonNoStore({ error: 'Falta la empresa' }, 400);
    if (!companyAccess(ctx, idCompany)) return jsonNoStore({ error: 'Sin acceso al SGC de esta empresa' }, 403);
    const params = new URL(request.url).searchParams;
    const rawConfig = params.get('config');
    let config: unknown = undefined;
    if (rawConfig) {
      if (rawConfig.length > 4000) return jsonNoStore({ error: 'Configuración demasiado larga' }, 400);
      try {
        config = JSON.parse(Buffer.from(rawConfig, 'base64url').toString('utf8'));
      } catch {
        return jsonNoStore({ error: 'Configuración inválida' }, 400);
      }
    }
    const id = Number(params.get('id'));
    const pdf = await buildHeaderTemplatePreview(prisma, idCompany, { idTemplate: Number.isInteger(id) && id > 0 ? id : null, config });
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent('vista-previa-encabezado.pdf')}`, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' },
    });
  } catch (error) {
    return errorResponse(error, 'encabezados:vista-previa');
  }
}
