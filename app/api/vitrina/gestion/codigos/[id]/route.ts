import { prisma } from '../../../../../../lib/prisma';
import { editarCodigo } from '../../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeCuerpo, jsonNoStore, parseId } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/** Activa/desactiva, canal, visibilidad del canal, país, marca, o devuelve el código a la bandeja. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Código no válido' }, 400);
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await editarCodigo(prisma, r.actor, id, r.body));
  } catch (error) {
    return errorResponse(error, 'codigo');
  }
}
