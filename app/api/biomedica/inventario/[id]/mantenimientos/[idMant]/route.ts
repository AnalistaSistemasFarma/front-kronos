import { prisma } from '../../../../../../../lib/prisma';
import { anularMantenimiento } from '../../../../../../../lib/biomedica/hojaVida';
import { errorResponse, jsonNoStore, parseId, readJson } from '../../../../../sgc/_lib/context';
import { biomedContext } from '../../../../_acceso';

export const dynamic = 'force-dynamic';

/** POST { company, motivo } — anula un mantenimiento (no se borra ni se cambia; fase 3). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; idMant: string }> }) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    const p = await params;
    const id = parseId(p.id);
    const idMant = parseId(p.idMant);
    if (!id || !idMant) return jsonNoStore({ error: 'Mantenimiento inválido' }, 400);
    return jsonNoStore(await anularMantenimiento(prisma, c.access, id, idMant, body, c.actor));
  } catch (error) {
    return errorResponse(error, 'biomedica:mantenimiento:anular');
  }
}
