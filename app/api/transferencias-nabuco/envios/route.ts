import { NABUCO_ESTADOS } from '../../../../lib/transferencias-nabuco/constants';
import { kpis, listarConfigs, listarEnvios } from '../../../../lib/transferencias-nabuco/db';
import { errorResponse, getNabucoContext, jsonNoStore, parseId, requireEmpresa } from '../_lib/context';

export const dynamic = 'force-dynamic';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** GET ?company=&config=&estado=&desde=&hasta=&docNum= — tablero: KPIs, última corrida por config y envíos. */
export async function GET(request: Request) {
  const ctx = await getNabucoContext();
  if (ctx instanceof Response) return ctx;
  const sp = new URL(request.url).searchParams;
  const company = parseId(sp.get('company'));
  const denegado = requireEmpresa(ctx, company, 'leer');
  if (denegado) return denegado;
  const estado = sp.get('estado');
  const desde = sp.get('desde');
  const hasta = sp.get('hasta');
  try {
    const idConfig = parseId(sp.get('config'));
    const [envios, k, configs] = await Promise.all([
      listarEnvios({
        idCompany: company!,
        idConfig,
        estado: estado && (NABUCO_ESTADOS as readonly string[]).includes(estado) ? estado : null,
        desde: desde && FECHA.test(desde) ? desde : null,
        hasta: hasta && FECHA.test(hasta) ? hasta : null,
        docNum: parseId(sp.get('docNum')),
      }),
      kpis(company!, idConfig),
      listarConfigs(company!),
    ]);
    const corridas = configs.map((c) => ({
      id_config: c.id_config,
      nombre: c.nombre,
      activo: c.activo,
      modo_simulacion: c.modo_simulacion,
      last_run_date: c.last_run_date,
      last_status: c.last_status,
      cron_expression: c.cron_expression,
    }));
    return jsonNoStore({ envios, kpis: k, configs: corridas });
  } catch (e) {
    return errorResponse(e, 'envios:get');
  }
}
