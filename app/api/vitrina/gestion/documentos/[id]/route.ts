import { prisma } from '../../../../../../lib/prisma';
import { desvincularDocumento } from '../../../../../../lib/vitrina/mediosDb';
import { errorResponse, gestionDesdeUrl, jsonNoStore, parseId } from '../../../_lib/context';

export const dynamic = 'force-dynamic';

/** Quita el vínculo con el documento del SGC (el documento sigue intacto en el SGC). Empresa en ?company=. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) return jsonNoStore({ error: 'Vínculo no válido' }, 400);
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    return jsonNoStore(await desvincularDocumento(prisma, actor, id));
  } catch (error) {
    return errorResponse(error, 'documento:desvincular');
  }
}
