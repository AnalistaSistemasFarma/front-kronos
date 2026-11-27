import { prisma } from '../../../../../lib/prisma';
import { moverRepuesto, movimientosRepuesto } from '../../../../../lib/biomedica/repuestos';
import { errorResponse, jsonNoStore, parseId, readJson } from '../../../sgc/_lib/context';
import { biomedContext } from '../../_acceso';

export const dynamic = 'force-dynamic';

/** GET ?company= — movimientos del repuesto. POST { company, tipo, cantidad, idEquipo?, referencia?, observacion? } — movimiento. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await biomedContext(request, new URL(request.url).searchParams.get('company'));
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Repuesto inválido' }, 400);
    return jsonNoStore(await movimientosRepuesto(prisma, c.access, id));
  } catch (error) {
    return errorResponse(error, 'biomedica:repuestos:movimientos');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Repuesto inválido' }, 400);
    return jsonNoStore(await moverRepuesto(prisma, c.access, id, body, c.actor), 201);
  } catch (error) {
    return errorResponse(error, 'biomedica:repuestos:mover');
  }
}
