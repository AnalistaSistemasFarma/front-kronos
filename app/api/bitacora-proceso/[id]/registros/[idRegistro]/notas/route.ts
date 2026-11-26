import { prisma } from '../../../../../../../lib/prisma';
import { crearNotaRegistro } from '../../../../../../../lib/bitacora-proceso/db';
import { parseNotaRegistro } from '../../../../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, parseCompanyParam, parseId, readJson, requireCompany } from '../../../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/[id]/registros/[idRegistro]/notas?company=1  { texto }
 * Nota de corrección sobre un registro (2026-11-26: «toqué la actividad equivocada»). El registro no
 * cambia; la nota lleva la hora del servidor y el usuario de la sesión. No hay PUT ni DELETE.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; idRegistro: string }> }) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const p = await params;
    const id = parseId(p.id);
    const idRegistro = /^\d{1,18}$/.test(p.idRegistro ?? '') ? BigInt(p.idRegistro) : null;
    if (!id || !idRegistro || idRegistro < BigInt(1)) return jsonNoStore({ error: 'Registro no válido' }, 400);
    const access = requireCompany(ctx, parseCompanyParam(request.url));
    if (access instanceof Response) return access;
    const { texto } = parseNotaRegistro(await readJson(request));
    const nota = await crearNotaRegistro(prisma, id, idRegistro, access, texto, ctx.actor);
    return jsonNoStore({ nota }, 201);
  } catch (error) {
    return errorResponse(error, 'nota');
  }
}
