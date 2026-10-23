import { prisma } from '../../../../../../lib/prisma';
import { retirarImagen } from '../../../../../../lib/vitrina/mediosDb';
import { errorResponse, gestionDesdeUrl, jsonNoStore, parseId } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/** Retira la imagen (deja de mostrarse; queda en el historial). Empresa en ?company=. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Imagen no válida' }, 400);
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    return jsonNoStore(await retirarImagen(prisma, actor, id));
  } catch (error) {
    return errorResponse(error, 'imagen:retirar');
  }
}
