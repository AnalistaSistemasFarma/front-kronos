import { parseSeleccion } from '../../../../lib/correo/rules';
import { simular } from '../../../../lib/correo/service';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/correo/simular { mensajesIds[], empresa, procesoPredeterminado? }
 * Vista previa: una fila por hilo, SIN crear nada ni guardar el contenido de los correos.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request);
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    const mensajesIds = parseSeleccion(body);
    const empresa = Number(body?.empresa);
    if (!Number.isInteger(empresa) || empresa <= 0) return jsonNoStore({ error: 'Elija la empresa.' }, 400);
    const pred = Number(body?.procesoPredeterminado);
    const sim = await simular(ctx.deps, ctx.acceso, {
      mensajesIds,
      idCompany: empresa,
      procesoPredeterminado: Number.isInteger(pred) && pred > 0 ? pred : null,
      ip: ctx.ip,
    });
    return jsonNoStore(sim);
  } catch (error) {
    return errorResponse(error, 'simular');
  }
}
