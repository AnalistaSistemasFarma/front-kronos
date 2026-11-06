import { prisma } from '../../../../../lib/prisma';
import { sincronizarEmpresa } from '../../../../../lib/vitrina/syncDb';
import { SapError } from '../../../../../lib/sap/serviceLayer';
import { errorResponse, gestionDesdeCuerpo, jsonNoStore } from '../../_lib/context';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * «Actualizar ahora»: lee el SAP de la empresa (SOLO LECTURA) y actualiza los códigos,
 * su estado en SAP y el registro sanitario. Solo con «Vitrina Comercial · Gestión» en ESA empresa.
 * La lectura nocturna la hace el programador central (job vitrina_sincronizar_sap).
 */
export async function POST(request: Request) {
  const r = await gestionDesdeCuerpo(request);
  if (r instanceof Response) return r;
  try {
    return jsonNoStore(await sincronizarEmpresa(prisma, r.actor.idCompany, r.actor.idUser));
  } catch (error) {
    if (error instanceof SapError) {
      console.error('[vitrina/sincronizar] SAP', error.status, error.message);
      return jsonNoStore({ error: `No se pudo leer SAP: ${error.message}` }, 502);
    }
    return errorResponse(error, 'sincronizar');
  }
}
