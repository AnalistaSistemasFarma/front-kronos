import { prisma } from '../../../../lib/prisma';
import { createRegistro } from '../../../../lib/biomedica/db';
import { errorResponse, jsonNoStore, readJson } from '../../sgc/_lib/context';
import { biomedContext } from '../_acceso';

export const dynamic = 'force-dynamic';

/** POST /api/biomedica/registros { company, idFormato, equipo, serial? } — nuevo formato diligenciado sobre la versión vigente. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    return jsonNoStore(await createRegistro(prisma, c.access, body, c.actor), 201);
  } catch (error) {
    return errorResponse(error, 'biomedica:registros');
  }
}
