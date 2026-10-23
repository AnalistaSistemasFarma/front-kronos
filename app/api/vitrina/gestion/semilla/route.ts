import { prisma } from '../../../../../lib/prisma';
import { importarSemilla } from '../../../../../lib/vitrina/service';
import { errorResponse, gestionDesdeCuerpo, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Importa la carga inicial (CSV «;») como SUGERENCIA: llena la bandeja con presentación,
 * familia, país y tipo sugeridos. No crea presentaciones ni activa nada. Cuerpo: { company, csv }.
 */
export async function POST(request: Request) {
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await importarSemilla(prisma, r.actor, String(r.body.csv ?? '')));
  } catch (error) {
    return errorResponse(error, 'semilla');
  }
}
