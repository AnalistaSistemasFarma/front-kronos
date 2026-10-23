import { prisma } from '../../../../../../lib/prisma';
import { editarExclusividad, eliminarExclusividad } from '../../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeCuerpo, gestionDesdeUrl, jsonNoStore, parseId } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Exclusividad no válida' }, 400);
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await editarExclusividad(prisma, r.actor, id, r.body));
  } catch (error) {
    return errorResponse(error, 'exclusividad');
  }
}

/** Elimina la exclusividad (queda el valor anterior completo en el historial). Empresa en ?company=. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Exclusividad no válida' }, 400);
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    return jsonNoStore(await eliminarExclusividad(prisma, actor, id));
  } catch (error) {
    return errorResponse(error, 'exclusividad');
  }
}
