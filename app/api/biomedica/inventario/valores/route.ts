import { prisma } from '../../../../../lib/prisma';
import { listValores, saveValor } from '../../../../../lib/biomedica/inventario';
import { errorResponse, jsonNoStore, readJson } from '../../../sgc/_lib/context';
import { biomedContext } from '../../_acceso';

export const dynamic = 'force-dynamic';

/** GET ?company= — valores unitarios por código interno. POST { company, codigo, valor } — guarda uno. */
export async function GET(request: Request) {
  try {
    const c = await biomedContext(request, new URL(request.url).searchParams.get('company'));
    if (c instanceof Response) return c;
    return jsonNoStore({ valores: await listValores(prisma, c.access) });
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario:valores');
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    return jsonNoStore(await saveValor(prisma, c.access, body, c.actor));
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario:valor');
  }
}
