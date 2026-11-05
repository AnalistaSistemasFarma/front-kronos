import { probarConexionRegistrada } from '../../../../../../lib/transferencias-nabuco/pruebas';
import { errorResponse, jsonNoStore, readJson } from '../../../_lib/context';
import { cargarConfig } from '../_cargar';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * «Probar conexión»: SIEMPRE pide un token nuevo a Nabuco. No envía nada ni devuelve el token.
 * Body opcional { nabuco_url, nabuco_usuario, nabuco_password, nabuco_org, ruta_token, timeout_ms }:
 * cada campo reemplaza al guardado SOLO para esta prueba (no guarda nada; contraseña vacía = la
 * guardada). Si difiere de lo guardado → usaCambiosSinGuardar: true y NO se toca la caché de token.
 * Respuesta: 200 { ok, mensaje, usaCambiosSinGuardar, diagnostico, http_status, duracion_ms } también
 * cuando Nabuco o la red fallan (ok:false). 400 con diagnóstico si los datos no son válidos.
 * Deja registro tipo 'conexion' en nabuco_prueba_manual.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  const body = await readJson(request);
  try {
    const res = await probarConexionRegistrada(r.cfg, r.ctx.email, body);
    const d = res.diagnostico;
    return jsonNoStore({
      ok: res.ok,
      mensaje: res.ok ? `Conexión correcta: Nabuco entregó un token (HTTP ${res.http_status}, ${res.duracion_ms} ms).` : d.mensaje,
      ...(res.ok ? {} : { error: d.mensaje }),
      usaCambiosSinGuardar: Boolean(res.usaCambiosSinGuardar),
      http_status: res.http_status,
      duracion_ms: res.duracion_ms,
      diagnostico: d,
    });
  } catch (e) {
    return errorResponse(e, 'probar');
  }
}
