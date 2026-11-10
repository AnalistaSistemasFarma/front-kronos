import { prisma } from '../../../../../lib/prisma';
import { moverEquipos } from '../../../../../lib/biomedica/inventario';
import { errorResponse, jsonNoStore, readJson } from '../../../sgc/_lib/context';
import { biomedContext } from '../../_acceso';

export const dynamic = 'force-dynamic';

/** POST { company, accion: distribuir|devolver|faltante|danado|reintegrar, ids, cliente?, sede?, zona?, ciudad?, observacion? }. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    return jsonNoStore(await moverEquipos(prisma, c.access, body, c.actor));
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario:movimiento');
  }
}
