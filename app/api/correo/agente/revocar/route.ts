import { revocarConcesion } from '../../../../../lib/correo/agente';
import { agentePort } from '../../../../../lib/correo/agenteRuntime';
import { errorResponse, getCorreoContext, jsonNoStore, readJson } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/** POST /api/correo/agente/revocar { id } — revoca el acceso del agente al hilo (solo una concesión propia). */
export async function POST(request: Request) {
  try {
    const ctx = await getCorreoContext(request, 'creacion');
    if (ctx instanceof Response) return ctx;
    const body = await readJson(request);
    return jsonNoStore(await revocarConcesion(ctx.deps, agentePort(), ctx.acceso, Number(body?.id), ctx.ip));
  } catch (error) {
    return errorResponse(error, 'agente-revocar');
  }
}
