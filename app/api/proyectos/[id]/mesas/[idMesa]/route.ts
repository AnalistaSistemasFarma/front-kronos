import { NextRequest } from 'next/server';
import { jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../lib/proyectos/acciones';
import { accionMesa, detalleMesa } from '../../../../../../lib/proyectos/mesas';

export const dynamic = 'force-dynamic';

/**
 * UNA mesa de discusión.
 *
 *   GET                       -> detalle con estado en vivo y registro de eventos (cualquier miembro)
 *   POST { accion }           -> pausar | reanudar | cerrar | ronda_ahora (dueño o editor)
 */
function idValido(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && String(n) === raw ? n : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; idMesa: string }> }) {
  try {
    const { id, idMesa } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const n = idValido(idMesa);
    if (!n) return jsonNoStore({ error: 'Mesa no encontrada.' }, { status: 404 });
    return jsonNoStore({ mesa: await detalleMesa(guard.project, n) });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('GET /api/proyectos/[id]/mesas/[idMesa]', error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; idMesa: string }> }) {
  try {
    const { id, idMesa } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const n = idValido(idMesa);
    if (!n) return jsonNoStore({ error: 'Mesa no encontrada.' }, { status: 404 });
    const payload = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
    return jsonNoStore(await accionMesa(guard.user, guard.project, n, payload.accion));
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/mesas/[idMesa]', error);
  }
}
