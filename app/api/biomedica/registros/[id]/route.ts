import { prisma } from '../../../../../lib/prisma';
import { getRegistro, saveAnotaciones } from '../../../../../lib/biomedica/db';
import { AnotacionInvalida } from '../../../../../lib/biomedica/anotaciones';
import { errorResponse, jsonNoStore, parseId, readJson } from '../../../sgc/_lib/context';
import { biomedContext } from '../../_acceso';

export const dynamic = 'force-dynamic';

/**
 * GET /api/biomedica/registros/<id>?company= — el registro con lo diligenciado y si está bloqueado.
 * PUT { company, anotaciones } — guarda lo escrito encima del formato (borrador, formato vigente).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await biomedContext(request, new URL(request.url).searchParams.get('company'));
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Registro inválido' }, 400);
    return jsonNoStore(await getRegistro(prisma, c.access, id, c.email));
  } catch (error) {
    return errorResponse(error, 'biomedica:registro');
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    const id = parseId((await params).id);
    if (!id) return jsonNoStore({ error: 'Registro inválido' }, 400);
    return jsonNoStore(await saveAnotaciones(prisma, c.access, id, body.anotaciones, c.actor));
  } catch (error) {
    if (error instanceof AnotacionInvalida) return jsonNoStore({ error: error.message }, 400);
    return errorResponse(error, 'biomedica:registro:guardar');
  }
}
