import { prisma } from '../../../../../lib/prisma';
import { listarAlertas } from '../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeUrl, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** Alertas vivas (registro vencido/por vencer/sin registro, inactivos en SAP, exclusividades). */
export async function GET(request: Request) {
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    return jsonNoStore(await listarAlertas(prisma, actor.idCompany));
  } catch (error) {
    return errorResponse(error, 'alertas');
  }
}
