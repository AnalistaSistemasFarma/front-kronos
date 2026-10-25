import { probarConexion } from '../../../../../../lib/transferencias-nabuco/motor';
import { errorResponse, jsonNoStore } from '../../../_lib/context';
import { cargarConfig } from '../_cargar';

export const dynamic = 'force-dynamic';

/** «Probar conexión»: solo pide el token a Nabuco (no envía nada ni devuelve el token). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  try {
    await probarConexion(r.cfg);
    return jsonNoStore({ ok: true, mensaje: 'Conexión correcta: Nabuco entregó un token.' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonNoStore({ ok: false, error: `No se pudo conectar con Nabuco: ${msg}` }, 502);
  }
}
