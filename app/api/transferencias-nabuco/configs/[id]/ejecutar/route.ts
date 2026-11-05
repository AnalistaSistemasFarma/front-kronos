import { registrarCorridaManual } from '../../../../../../lib/transferencias-nabuco/db';
import { correrConfig, textoResumen } from '../../../../../../lib/transferencias-nabuco/motor';
import { errorResponse, jsonNoStore } from '../../../_lib/context';
import { cargarConfig } from '../_cargar';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** «Ejecutar ahora»: corre la config (con su lock) y deja la corrida en scheduled_job_run. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  try {
    const res = await correrConfig(r.cfg.id_config, { usuario: r.ctx.email });
    const texto = `${textoResumen(res, res.simulacion)} (manual: ${r.ctx.email})`;
    if (r.cfg.id_job && !res.omitido) await registrarCorridaManual(r.cfg.id_job, res.errores > 0 && res.enviados + res.simulados === 0 ? 'error' : 'ok', texto, `config:${r.cfg.id_config}`);
    return jsonNoStore({ resumen: res, texto });
  } catch (e) {
    if (r.cfg.id_job) await registrarCorridaManual(r.cfg.id_job, 'error', `${e instanceof Error ? e.message : String(e)} (manual: ${r.ctx.email})`, `config:${r.cfg.id_config}`).catch(() => undefined);
    return errorResponse(e, 'ejecutar');
  }
}
