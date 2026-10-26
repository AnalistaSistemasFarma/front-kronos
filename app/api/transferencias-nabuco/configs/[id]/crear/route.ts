import { EntradaInvalida, crearDocumentos, validarDocEntries } from '../../../../../../lib/transferencias-nabuco/asistida';
import { errorResponse, jsonNoStore, readJson } from '../../../_lib/context';
import { cargarConfig } from '../_cargar';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST { docEntries: number[], confirmoProduccion?: boolean } (máx. 200) — envía DE VERDAD a Nabuco
 * (ignora el modo simulación; solo esta acción), uno por uno, por el camino del motor. No reenvía
 * los ya enviados. A producción de Nabuco solo con confirmoProduccion === true. 409 si está ocupada.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  const body = await readJson(request);
  if (!body) return jsonNoStore({ error: 'Cuerpo de la petición no válido' }, 400);
  try {
    const docEntries = validarDocEntries(body.docEntries);
    return jsonNoStore({ resultados: await crearDocumentos(r.cfg, docEntries, r.ctx.email, body.confirmoProduccion) });
  } catch (e) {
    if (e instanceof EntradaInvalida) return jsonNoStore({ error: e.message }, 400);
    return errorResponse(e, 'crear');
  }
}
