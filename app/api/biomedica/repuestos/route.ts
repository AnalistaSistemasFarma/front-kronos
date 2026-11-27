import { prisma } from '../../../../lib/prisma';
import { guardarRepuesto, listRepuestos } from '../../../../lib/biomedica/repuestos';
import { errorResponse, jsonNoStore, readJson } from '../../sgc/_lib/context';
import { biomedContext } from '../_acceso';

export const dynamic = 'force-dynamic';

/** REPUESTOS E INSUMOS (2026-11-26). GET ?company=&tipo=&q= — lista. POST { company, id?, tipo, nombre, … } — alta o edición. */
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const c = await biomedContext(request, p.get('company'));
    if (c instanceof Response) return c;
    return jsonNoStore({ items: await listRepuestos(prisma, c.access, { tipo: p.get('tipo'), q: p.get('q') }) });
  } catch (error) {
    return errorResponse(error, 'biomedica:repuestos');
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    return jsonNoStore(await guardarRepuesto(prisma, c.access, body, c.actor), 201);
  } catch (error) {
    return errorResponse(error, 'biomedica:repuestos:guardar');
  }
}
