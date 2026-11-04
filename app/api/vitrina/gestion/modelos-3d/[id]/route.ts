import { prisma } from '../../../../../../lib/prisma';
import { editarDimensionesModelo3d, retirarModelo3d } from '../../../../../../lib/vitrina/mediosDb';
import { errorResponse, gestionDesdeCuerpo, gestionDesdeUrl, jsonNoStore, parseId } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/** Medidas opcionales del modelo vigente en cm ({ company, ancho_cm, alto_cm, profundo_cm }). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Modelo no válido' }, 400);
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await editarDimensionesModelo3d(prisma, r.actor, id, r.body));
  } catch (error) {
    return errorResponse(error, 'modelo3d:editar');
  }
}

/** Retira el modelo 3D (deja de mostrarse; queda en el historial). Empresa en ?company=. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Modelo no válido' }, 400);
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    return jsonNoStore(await retirarModelo3d(prisma, actor, id));
  } catch (error) {
    return errorResponse(error, 'modelo3d:retirar');
  }
}
