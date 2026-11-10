import { prisma } from '../../../../../lib/prisma';
import { editarEquipo, historialEquipo } from '../../../../../lib/biomedica/inventario';
import { errorResponse, jsonNoStore, parseId, readJson } from '../../../sgc/_lib/context';
import { biomedContext } from '../../_acceso';

export const dynamic = 'force-dynamic';

/**
 * GET ?company= — el equipo con su historial (control de cambios).
 * PATCH { company, <campos>, justificacion } — cambia sus datos (cambiar la serie es «cambio de serial»).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await biomedContext(request, new URL(request.url).searchParams.get('company'));
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Equipo inválido' }, 400);
    return jsonNoStore(await historialEquipo(prisma, c.access, id));
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario:equipo');
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
    return jsonNoStore(await editarEquipo(prisma, c.access, id, body, c.actor));
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario:editar');
  }
}
