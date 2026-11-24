import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { formatoHojaVida, getHojaVida, hojaVidaHtml } from '../../../../../../../lib/biomedica/hojaVida';
import { htmlToPdf } from '../../../../../../../lib/sgc/pdf/render';
import { NO_STORE, errorResponse, jsonNoStore, parseId, rateLimitResponse } from '../../../../../sgc/_lib/context';
import { biomedContext } from '../../../../_acceso';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET ?company= — «Generar reporte»: la hoja de vida en PDF con toda la trazabilidad (fase 3, 2026-11-23). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await biomedContext(request, new URL(request.url).searchParams.get('company'));
    if (c instanceof Response) return c;
    const limited = rateLimitResponse('archivo', c.email);
    if (limited) return limited;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Equipo inválido' }, 400);
    const [hoja, formato] = await Promise.all([getHojaVida(prisma, c.access, id), formatoHojaVida(prisma, c.access.idCompany)]);
    const pdf = await htmlToPdf(hojaVidaHtml(hoja, formato, { empresa: c.access.companyName, generadoPor: c.email, generadoAt: new Date() }));
    const nombre = `hoja-de-vida-${hoja.equipo.serie.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60)}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"`, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' },
    });
  } catch (error) {
    return errorResponse(error, 'biomedica:hoja-vida:pdf');
  }
}
