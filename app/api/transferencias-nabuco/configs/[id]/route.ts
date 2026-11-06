import { getNextRunDate, validateCronExpression } from '../../../../../lib/scheduler/runner';
import { listarEndpointsSap } from '../../../../../lib/transferencias-nabuco/access';
import { NabucoError, actualizarConfig, configPublica, validarEntradaConfig } from '../../../../../lib/transferencias-nabuco/db';
import { errorResponse, jsonNoStore, readJson } from '../../_lib/context';
import { cargarConfig } from './_cargar';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  return jsonNoStore({ config: configPublica(r.cfg) });
}

/** PATCH — edita la config y su tarea (cron, activo). La contraseña solo cambia si viene con texto. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await cargarConfig(params, 'admin');
  if (r instanceof Response) return r;
  const body = await readJson(request);
  if (!body) return jsonNoStore({ error: 'Cuerpo de la petición no válido' }, 400);
  try {
    const entrada = validarEntradaConfig(body, false);
    const errCron = validateCronExpression(entrada.cron_expression);
    if (errCron) throw new NabucoError(`Expresión cron inválida: ${errCron}`);
    if (entrada.id_sap_endpoint && !(await listarEndpointsSap(r.cfg.id_company)).some((e) => e.id === entrada.id_sap_endpoint)) {
      throw new NabucoError('La conexión SAP no pertenece a esta empresa.');
    }
    await actualizarConfig(r.cfg, entrada, r.ctx.email, getNextRunDate(entrada.cron_expression));
    return jsonNoStore({ ok: true });
  } catch (e) {
    return errorResponse(e, 'configs:patch');
  }
}
