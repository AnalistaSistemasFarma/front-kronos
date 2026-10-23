import { prisma } from '../../../../../lib/prisma';
import { listarHistorial } from '../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeUrl, jsonNoStore, parseId } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** Historial de solo lectura. Filtros: entidad, id (entidad), antes (paginación). */
export async function GET(request: Request) {
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    const sp = new URL(request.url).searchParams;
    return jsonNoStore(await listarHistorial(prisma, actor.idCompany, { entidad: sp.get('entidad'), idEntidad: parseId(sp.get('id')), antesDe: sp.get('antes') }));
  } catch (error) {
    return errorResponse(error, 'historial');
  }
}
