import { prisma } from '../../../../../lib/prisma';
import { listarMedios } from '../../../../../lib/vitrina/mediosDb';
import { errorResponse, gestionDesdeUrl, jsonNoStore, parseId } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** Imágenes (por tipo) y documentos del SGC vinculados de una presentación. ?company=&presentacion= */
export async function GET(request: Request) {
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  const id = parseId(new URL(request.url).searchParams.get('presentacion'));
  if (!id) return jsonNoStore({ error: 'Presentación no válida' }, 400);
  try {
    return jsonNoStore(await listarMedios(prisma, actor.idCompany, id));
  } catch (error) {
    return errorResponse(error, 'medios');
  }
}
