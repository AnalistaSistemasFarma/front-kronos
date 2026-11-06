import { prisma } from '../../../../../lib/prisma';
import { buscarDocumentosSgc } from '../../../../../lib/vitrina/mediosDb';
import { errorResponse, gestionDesdeUrl, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** Busca documentos VIGENTES del SGC de la empresa por código o título. ?company=&q= */
export async function GET(request: Request) {
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    return jsonNoStore(await buscarDocumentosSgc(prisma, actor.idCompany, new URL(request.url).searchParams.get('q')));
  } catch (error) {
    return errorResponse(error, 'documentos-sgc');
  }
}
