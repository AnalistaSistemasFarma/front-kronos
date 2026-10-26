import { prisma } from '../../../../../lib/prisma';
import { obtenerFicha } from '../../../../../lib/vitrina/consulta';
import { consultaDesdeUrl, errorResponse, jsonNoStore, parseId } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** Ficha (vista interna) de una presentación de la empresa, con sus documentos vigentes del SGC. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Presentación no válida' }, 400);
  const actor = await consultaDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    return jsonNoStore({ ficha: await obtenerFicha(prisma, actor.idCompany, id) });
  } catch (error) {
    return errorResponse(error, 'ficha');
  }
}
