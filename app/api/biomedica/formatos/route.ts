import { prisma } from '../../../../lib/prisma';
import { saveFormato } from '../../../../lib/biomedica/db';
import { errorResponse, jsonNoStore, readJson } from '../../sgc/_lib/context';
import { biomedContext } from '../_acceso';

export const dynamic = 'force-dynamic';

/** POST /api/biomedica/formatos { company, idDocument, actividad, isActive } — Calidad habilita o retira un formato vigente del SGC. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    return jsonNoStore(await saveFormato(prisma, c.access, body, c.actor), 201);
  } catch (error) {
    return errorResponse(error, 'biomedica:formatos');
  }
}
