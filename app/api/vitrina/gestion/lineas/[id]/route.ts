import { prisma } from '../../../../../../lib/prisma';
import { editarLinea } from '../../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeCuerpo, jsonNoStore, parseId } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/** Renombra, ordena o activa/desactiva una línea comercial de la empresa (no se borran). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Línea no válida' }, 400);
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await editarLinea(prisma, r.actor, id, r.body));
  } catch (error) {
    return errorResponse(error, 'lineas');
  }
}
