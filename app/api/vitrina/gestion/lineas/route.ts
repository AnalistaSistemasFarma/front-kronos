import { prisma } from '../../../../../lib/prisma';
import { crearLinea, listarLineas } from '../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeCuerpo, gestionDesdeUrl, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** Líneas comerciales de la empresa (cada empresa tiene las suyas). */
export async function GET(request: Request) {
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    return jsonNoStore({ lineas: await listarLineas(prisma, actor.idCompany) });
  } catch (error) {
    return errorResponse(error, 'lineas');
  }
}

export async function POST(request: Request) {
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await crearLinea(prisma, r.actor, r.body), 201);
  } catch (error) {
    return errorResponse(error, 'lineas');
  }
}
