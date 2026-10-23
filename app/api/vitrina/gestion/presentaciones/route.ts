import { prisma } from '../../../../../lib/prisma';
import { crearPresentacion, listarPresentaciones } from '../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeCuerpo, gestionDesdeUrl, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    return jsonNoStore({ presentaciones: await listarPresentaciones(prisma, actor.idCompany) });
  } catch (error) {
    return errorResponse(error, 'presentaciones');
  }
}

/** Crea una presentación (PENDIENTE) y, si vienen, le asigna códigos de la bandeja. No activa nada. */
export async function POST(request: Request) {
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await crearPresentacion(prisma, r.actor, r.body), 201);
  } catch (error) {
    return errorResponse(error, 'presentaciones');
  }
}
