import { prisma } from '../../../../lib/prisma';
import { listarCatalogo } from '../../../../lib/vitrina/consulta';
import { consultaDesdeUrl, errorResponse, jsonNoStore } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * Catálogo del comercial en su empresa. ?modo=presentacion arma en el SERVIDOR la
 * versión para el cliente (solo Vista al cliente u Ofertable, registro presentable,
 * sin códigos SAP, exclusividades ni estados internos). Sin stock ni precios.
 */
export async function GET(request: Request) {
  const actor = await consultaDesdeUrl(request);
  if (actor instanceof Response) return actor;
  const modo = new URL(request.url).searchParams.get('modo') === 'presentacion' ? 'presentacion' : 'interna';
  try {
    return jsonNoStore({ modo, ...(await listarCatalogo(prisma, actor.idCompany, modo)) });
  } catch (error) {
    return errorResponse(error, 'catalogo');
  }
}
