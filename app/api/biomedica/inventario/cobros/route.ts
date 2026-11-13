import { prisma } from '../../../../../lib/prisma';
import { cobros } from '../../../../../lib/biomedica/inventario';
import { errorResponse, jsonNoStore } from '../../../sgc/_lib/context';
import { biomedContext } from '../../_acceso';

export const dynamic = 'force-dynamic';

/** GET ?company= — cobro por cliente de los equipos faltantes o dañados. */
export async function GET(request: Request) {
  try {
    const c = await biomedContext(request, new URL(request.url).searchParams.get('company'));
    if (c instanceof Response) return c;
    return jsonNoStore(await cobros(prisma, c.access));
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario:cobros');
  }
}
