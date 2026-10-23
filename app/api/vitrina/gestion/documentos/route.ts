import { prisma } from '../../../../../lib/prisma';
import { vincularDocumento } from '../../../../../lib/vitrina/mediosDb';
import { errorResponse, gestionDesdeCuerpo, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** Vincula un documento vigente del SGC a la presentación (ficha, inserto o prospecto). Se enlaza, no se copia. */
export async function POST(request: Request) {
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await vincularDocumento(prisma, r.actor, r.body), 201);
  } catch (error) {
    return errorResponse(error, 'documento:vincular');
  }
}
