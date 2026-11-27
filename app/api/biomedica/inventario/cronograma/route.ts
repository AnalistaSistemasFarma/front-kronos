import { prisma } from '../../../../../lib/prisma';
import { cronogramaMantenimiento } from '../../../../../lib/biomedica/hojaVida';
import { errorResponse, jsonNoStore } from '../../../sgc/_lib/context';
import { biomedContext } from '../../_acceso';

export const dynamic = 'force-dynamic';

/** GET ?company=&year= — cronograma de mantenimiento preventivo (próximo por equipo, vencidos primero). 2026-11-26. */
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const c = await biomedContext(request, p.get('company'));
    if (c instanceof Response) return c;
    const year = Number(p.get('year')) || null;
    return jsonNoStore({ items: await cronogramaMantenimiento(prisma, c.access, year) });
  } catch (error) {
    return errorResponse(error, 'biomedica:cronograma');
  }
}
