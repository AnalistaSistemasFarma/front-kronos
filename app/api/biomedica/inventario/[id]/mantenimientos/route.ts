import { prisma } from '../../../../../../lib/prisma';
import { crearMantenimiento } from '../../../../../../lib/biomedica/hojaVida';
import { errorResponse, jsonNoStore, parseId, readJson } from '../../../../sgc/_lib/context';
import { biomedContext } from '../../../_acceso';

export const dynamic = 'force-dynamic';

/** POST { company, fecha, tipo, numeroReporte?, checklist?, observaciones?, responsables, idRegistro? } — nuevo mantenimiento (fase 3). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Equipo inválido' }, 400);
    return jsonNoStore(await crearMantenimiento(prisma, c.access, id, body, c.actor), 201);
  } catch (error) {
    return errorResponse(error, 'biomedica:mantenimiento:crear');
  }
}
