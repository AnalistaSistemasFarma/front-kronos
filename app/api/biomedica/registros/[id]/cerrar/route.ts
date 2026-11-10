import { prisma } from '../../../../../../lib/prisma';
import { closeRegistro } from '../../../../../../lib/biomedica/db';
import { errorResponse, jsonNoStore, parseId, readJson } from '../../../../sgc/_lib/context';
import { biomedContext } from '../../../_acceso';

export const dynamic = 'force-dynamic';

/** POST /api/biomedica/registros/<id>/cerrar { company } — cierra el registro (queda como evidencia). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Registro inválido' }, 400);
    return jsonNoStore(await closeRegistro(prisma, c.access, id, c.actor));
  } catch (error) {
    return errorResponse(error, 'biomedica:registro:cerrar');
  }
}
