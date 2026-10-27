import { getNextRunDate, validateCronExpression } from '../../../../lib/scheduler/runner';
import { listarEndpointsSap } from '../../../../lib/transferencias-nabuco/access';
import { NabucoError, configPublica, crearConfig, listarConfigs, validarEntradaConfig } from '../../../../lib/transferencias-nabuco/db';
import { errorResponse, getNabucoContext, jsonNoStore, parseId, readJson, requireEmpresa } from '../_lib/context';

export const dynamic = 'force-dynamic';

/** GET ?company= — configuraciones de la empresa (sin contraseñas) y conexiones SAP disponibles. */
export async function GET(request: Request) {
  const ctx = await getNabucoContext();
  if (ctx instanceof Response) return ctx;
  const company = parseId(new URL(request.url).searchParams.get('company'));
  const denegado = requireEmpresa(ctx, company, 'leer');
  if (denegado) return denegado;
  try {
    const configs = (await listarConfigs(company!)).map(configPublica);
    const esAdmin = ctx.access.some((a) => a.idCompany === company && a.canAdministrar);
    const endpoints = esAdmin ? await listarEndpointsSap(company!) : [];
    return jsonNoStore({ configs, endpoints });
  } catch (e) {
    return errorResponse(e, 'configs:get');
  }
}

/** POST { company, ...config } — crea una configuración (modo simulación encendido por defecto) y su tarea. */
export async function POST(request: Request) {
  const ctx = await getNabucoContext();
  if (ctx instanceof Response) return ctx;
  const body = await readJson(request);
  if (!body) return jsonNoStore({ error: 'Cuerpo de la petición no válido' }, 400);
  const company = parseId(body.company);
  const denegado = requireEmpresa(ctx, company, 'admin');
  if (denegado) return denegado;
  try {
    const entrada = validarEntradaConfig(body, true);
    const errCron = validateCronExpression(entrada.cron_expression);
    if (errCron) throw new NabucoError(`Expresión cron inválida: ${errCron}`);
    if (entrada.id_sap_endpoint && !(await listarEndpointsSap(company!)).some((e) => e.id === entrada.id_sap_endpoint)) {
      throw new NabucoError('La conexión SAP no pertenece a esta empresa.');
    }
    const id = await crearConfig(company!, entrada, ctx.email, getNextRunDate(entrada.cron_expression));
    return jsonNoStore({ id_config: id }, 201);
  } catch (e) {
    return errorResponse(e, 'configs:post');
  }
}
