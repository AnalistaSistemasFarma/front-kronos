import { prisma } from '../../../../../lib/prisma';
import { listarBandeja } from '../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeUrl, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** Bandeja: códigos SAP de la empresa que aún no tienen presentación. Filtros: grupo, pais, q. */
export async function GET(request: Request) {
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    const sp = new URL(request.url).searchParams;
    const grupoRaw = sp.get('grupo');
    const grupo = grupoRaw && /^\d+$/.test(grupoRaw) ? Number(grupoRaw) : null;
    return jsonNoStore(await listarBandeja(prisma, actor.idCompany, { grupo, pais: sp.get('pais'), q: sp.get('q') }));
  } catch (error) {
    return errorResponse(error, 'bandeja');
  }
}
