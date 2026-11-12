import { NextRequest } from 'next/server';
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import { flujoPorId } from '../../../../../lib/workflow/mejora-continua';

export const dynamic = 'force-dynamic';

/**
 * GET ?id=N → un flujo con la forma de la lista de Administración de flujos, para que el editor
 * (view-workflows) y la página de Mejora continua se abran por enlace (2026-11-09). Con sesión,
 * igual que la lista que ya entrega estos mismos datos.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const id = Number.parseInt(request.nextUrl.searchParams.get('id') ?? '', 10);
    if (!Number.isInteger(id) || id <= 0) return jsonNoStore({ error: 'Indique el flujo.' }, { status: 400 });
    const flujo = await flujoPorId(id);
    if (!flujo) return jsonNoStore({ error: 'Flujo no encontrado.' }, { status: 404 });
    return jsonNoStore({ flujo });
  } catch (error) {
    return serverError('GET /api/requests-general/mejora-continua/flujo', error);
  }
}
