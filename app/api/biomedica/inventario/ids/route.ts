import { prisma } from '../../../../../lib/prisma';
import { idsFiltrados } from '../../../../../lib/biomedica/inventario';
import { errorResponse, jsonNoStore } from '../../../sgc/_lib/context';
import { biomedContext } from '../../_acceso';

export const dynamic = 'force-dynamic';

/** GET ?company=&<filtros> — los id de lo filtrado («seleccionar todos»). */
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const c = await biomedContext(request, p.get('company'));
    if (c instanceof Response) return c;
    return jsonNoStore({ ids: await idsFiltrados(prisma, c.access, { q: p.get('q'), estado: p.get('estado'), cliente: p.get('cliente'), ciudad: p.get('ciudad'), codigo: p.get('codigo') }) });
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario:ids');
  }
}
