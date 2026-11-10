import { NextRequest } from 'next/server';
import { jsonNoStore, serverError } from '../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../lib/proyectos/acciones';
import { archivarMatriz, detalleMatriz } from '../../../../../../lib/proyectos/matrices';

export const dynamic = 'force-dynamic';

/**
 * UNA matriz.
 *   GET ?version=&hoja=&q=&orden=&desc=1&pagina=&porPagina=  -> grilla paginada, versiones y ficha (miembros)
 *   DELETE  -> archiva (dueño o editor; deja de llegarle a los agentes)
 */
const entero = (v: string | null) => {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isInteger(n) ? n : undefined;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; idMatrix: string }> }) {
  try {
    const { id, idMatrix } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const n = entero(idMatrix);
    if (!n || n <= 0) return jsonNoStore({ error: 'Matriz no encontrada.' }, { status: 404 });
    const sp = request.nextUrl.searchParams;
    const matriz = await detalleMatriz(guard.project, n, {
      idVersion: entero(sp.get('version')),
      hoja: entero(sp.get('hoja')),
      q: sp.get('q') ?? undefined,
      ordenarPor: entero(sp.get('orden')),
      descendente: sp.get('desc') === '1',
      pagina: entero(sp.get('pagina')),
      porPagina: entero(sp.get('porPagina')),
    });
    return jsonNoStore({ matriz });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('GET /api/proyectos/[id]/matrices/[idMatrix]', error);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; idMatrix: string }> }) {
  try {
    const { id, idMatrix } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const n = entero(idMatrix);
    if (!n || n <= 0) return jsonNoStore({ error: 'Matriz no encontrada.' }, { status: 404 });
    return jsonNoStore(await archivarMatriz(guard.project, n));
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('DELETE /api/proyectos/[id]/matrices/[idMatrix]', error);
  }
}
