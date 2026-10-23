import { prisma } from '../../../../../lib/prisma';
import { crearArea, listarAreas } from '../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeCuerpo, gestionDesdeUrl, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await gestionDesdeUrl(request);
  if (actor instanceof Response) return actor;
  try {
    return jsonNoStore({ areas: await listarAreas(prisma) });
  } catch (error) {
    return errorResponse(error, 'areas');
  }
}

export async function POST(request: Request) {
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await crearArea(prisma, r.actor, r.body), 201);
  } catch (error) {
    return errorResponse(error, 'areas');
  }
}
