import { PRUEBAS_MANUALES } from '../../../../../../lib/transferencias-nabuco/constants';
import { listarPruebasManuales } from '../../../../../../lib/transferencias-nabuco/db';
import { enviarPruebaManual, exigirConfirmacionProduccion, validarCuerpoManual } from '../../../../../../lib/transferencias-nabuco/pruebas';
import { errorResponse, jsonNoStore, parseId, readJson } from '../../../_lib/context';
import { cargarConfig } from '../_cargar';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET — historial de pruebas manuales de la config (últimas 20, sin payload ni respuesta). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  try {
    return jsonNoStore({ pruebas: await listarPruebasManuales(r.cfg.id_config, PRUEBAS_MANUALES.historial) });
  } catch (e) {
    return errorResponse(e, 'pruebas:get');
  }
}

/**
 * POST { payload: string (JSON), docEntry?: number | null, confirmoProduccion?: boolean }
 * Envío MANUAL a Nabuco, tal cual, ignorando el modo simulación. No toca nabuco_envio.
 * A la URL de producción de Nabuco solo con confirmoProduccion === true.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  const body = await readJson(request);
  if (!body) return jsonNoStore({ error: 'Cuerpo de la petición no válido' }, 400);
  try {
    const cuerpo = validarCuerpoManual(body.payload);
    exigirConfirmacionProduccion(r.cfg.nabuco_url, body.confirmoProduccion);
    const docEntry = body.docEntry === undefined || body.docEntry === null || body.docEntry === '' ? null : parseId(body.docEntry);
    const res = await enviarPruebaManual(r.cfg, r.ctx.email, cuerpo, docEntry);
    return jsonNoStore({ resultado: res });
  } catch (e) {
    return errorResponse(e, 'pruebas:post');
  }
}
