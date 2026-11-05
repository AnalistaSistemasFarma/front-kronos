import { buscarPendientes, validarLimite } from '../../../../../../lib/transferencias-nabuco/asistida';
import { errorResponse, jsonNoStore } from '../../../_lib/context';
import { cargarConfig } from '../_cargar';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET ?limite=50 — Transferencia asistida: documentos de SAP de la config (mismo filtro del motor)
 * que no están enviados ni descartados, del más reciente al más antiguo. Máx. 200.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  try {
    const limite = validarLimite(new URL(request.url).searchParams.get('limite'));
    const res = await buscarPendientes(r.cfg, limite);
    return jsonNoStore({ ...res, limite, url: r.cfg.nabuco_url });
  } catch (e) {
    return errorResponse(e, 'pendientes');
  }
}
