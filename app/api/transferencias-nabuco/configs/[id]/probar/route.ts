import { probarConexionRegistrada } from '../../../../../../lib/transferencias-nabuco/pruebas';
import { errorResponse, jsonNoStore } from '../../../_lib/context';
import { cargarConfig } from '../_cargar';

export const dynamic = 'force-dynamic';

/**
 * «Probar conexión»: SIEMPRE pide un token nuevo a Nabuco (y actualiza la caché del proceso).
 * No envía nada ni devuelve el token. Deja registro tipo 'conexion' en nabuco_prueba_manual.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  try {
    const res = await probarConexionRegistrada(r.cfg, r.ctx.email);
    if (res.ok) return jsonNoStore({ ok: true, mensaje: `Conexión correcta: Nabuco entregó un token (HTTP ${res.http_status}, ${res.duracion_ms} ms).`, http_status: res.http_status, duracion_ms: res.duracion_ms });
    return jsonNoStore({ ok: false, error: `No se pudo conectar con Nabuco: ${res.error}`, http_status: res.http_status, duracion_ms: res.duracion_ms }, 502);
  } catch (e) {
    return errorResponse(e, 'probar');
  }
}
