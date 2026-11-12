import { prisma } from '../../../lib/prisma';
import { BIOMED_ACTIVIDADES, listFormatos, listRegistros } from '../../../lib/biomedica/db';
import { errorResponse, jsonNoStore } from '../sgc/_lib/context';
import { biomedContext } from './_acceso';

export const dynamic = 'force-dynamic';

/**
 * GET /api/biomedica?company=<id>[&q=equipo o serial] — INGENIERÍA BIOMÉDICA (2026-11-06):
 * acceso de la persona, actividades, formatos habilitados y registros diligenciados.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const c = await biomedContext(request, url.searchParams.get('company'));
    if (c instanceof Response) return c;
    const [formatos, registros] = await Promise.all([listFormatos(prisma, c.access), listRegistros(prisma, c.access, { q: url.searchParams.get('q') })]);
    return jsonNoStore({ access: c.access, actividades: BIOMED_ACTIVIDADES, formatos, registros });
  } catch (error) {
    return errorResponse(error, 'biomedica');
  }
}
