import { obtenerPruebaManual } from '../../../../../../../lib/transferencias-nabuco/db';
import { errorResponse, jsonNoStore, parseId } from '../../../../_lib/context';
import { cargarConfig } from '../../_cargar';

export const dynamic = 'force-dynamic';

/** GET — detalle de una prueba manual (payload enviado y respuesta de Nabuco). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; idPrueba: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  const idPrueba = parseId((await params).idPrueba);
  if (!idPrueba) return jsonNoStore({ error: 'Prueba no válida' }, 400);
  try {
    const prueba = await obtenerPruebaManual(idPrueba);
    if (!prueba || prueba.id_config !== r.cfg.id_config) return jsonNoStore({ error: 'Prueba no encontrada' }, 404);
    return jsonNoStore({ prueba });
  } catch (e) {
    return errorResponse(e, 'pruebas:detalle');
  }
}
