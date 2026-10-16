import { prisma } from '../../../../../lib/prisma';
import { importarOperadores } from '../../../../../lib/bitacora-proceso/db';
import { parseImportarOperadores } from '../../../../../lib/bitacora-proceso/rules';
import { errorResponse, getOtRequestContext, jsonNoStore, readJson, requireCompany } from '../../_lib/context';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bitacora-proceso/operadores/importar  { company, texto, simular? }
 * Importa el maestro de operarios pegando la lista (B8): una persona por línea,
 * «Nombre completo; documento». Con `simular` (por defecto) solo muestra qué crearía.
 * Solo Gestión. Crea solo los nombres que no existen; no edita ni desactiva nada.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getOtRequestContext(request);
    if (ctx instanceof Response) return ctx;
    const input = parseImportarOperadores(await readJson(request));
    const access = requireCompany(ctx, input.idCompany, 'canManage');
    if (access instanceof Response) return access;
    return jsonNoStore(await importarOperadores(prisma, input, ctx.actor));
  } catch (error) {
    return errorResponse(error, 'operadores-importar');
  }
}
