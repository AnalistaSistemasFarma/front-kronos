import { prisma } from '../../../../../../lib/prisma';
import { editarPresentacion } from '../../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeCuerpo, jsonNoStore, parseId } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/** Edita datos, estado (validar/retirar), visibilidad (regla de terceros) y áreas. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Presentación no válida' }, 400);
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await editarPresentacion(prisma, r.actor, id, r.body));
  } catch (error) {
    return errorResponse(error, 'presentacion');
  }
}
