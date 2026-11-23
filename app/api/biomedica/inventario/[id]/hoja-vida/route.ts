import { prisma } from '../../../../../../lib/prisma';
import { getHojaVida, guardarFicha } from '../../../../../../lib/biomedica/hojaVida';
import { errorResponse, jsonNoStore, parseId, readJson } from '../../../../sgc/_lib/context';
import { biomedContext } from '../../../_acceso';

export const dynamic = 'force-dynamic';

/**
 * HOJA DE VIDA del equipo (fase 3, 2026-11-23).
 * GET ?company= — datos, ficha (ingreso, vida útil, periodicidad, próximo preventivo), mantenimientos,
 *   formatos diligenciados del equipo e historial.
 * PATCH { company, fechaIngreso?, vidaUtilAnios?, periodicidadMeses?, justificacion? } — datos de la hoja de vida.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await biomedContext(request, new URL(request.url).searchParams.get('company'));
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Equipo inválido' }, 400);
    return jsonNoStore(await getHojaVida(prisma, c.access, id));
  } catch (error) {
    return errorResponse(error, 'biomedica:hoja-vida');
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Equipo inválido' }, 400);
    return jsonNoStore(await guardarFicha(prisma, c.access, id, body, c.actor));
  } catch (error) {
    return errorResponse(error, 'biomedica:hoja-vida:guardar');
  }
}
