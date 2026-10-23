import { prisma } from '../../../../../../../lib/prisma';
import { asignarCodigos } from '../../../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeCuerpo, jsonNoStore, parseId } from '../../../../_lib/context';

export const dynamic = 'force-dynamic';

/** Agrupa: asigna códigos de la bandeja a una presentación existente. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Presentación no válida' }, 400);
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await asignarCodigos(prisma, r.actor, id, r.body));
  } catch (error) {
    return errorResponse(error, 'agrupar');
  }
}
