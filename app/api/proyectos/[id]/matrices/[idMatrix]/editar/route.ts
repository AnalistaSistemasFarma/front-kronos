import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../../lib/proyectos/acciones';
import { editarMatriz } from '../../../../../../../lib/proyectos/matrices';

export const dynamic = 'force-dynamic';

/**
 * EDITAR una matriz dentro de SynerLink (2026-11-05). Dueño o editor.
 *
 *   POST { idVersionBase, hoja, cambios: [{ fila, col, valor }], nuevas: string[][], borrar: number[] }
 *     → 201 { idMatrix, idVersion, versionNo, resumen }   (una VERSIÓN nueva)
 *     → 409 si alguien guardó otra versión mientras tanto.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; idMatrix: string }> }) {
  try {
    const { id, idMatrix } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const n = Number.parseInt(idMatrix, 10);
    if (!Number.isInteger(n) || n <= 0) return jsonNoStore({ error: 'Matriz no encontrada.' }, { status: 404 });
    const datos = await readJsonBody(request);
    if (!datos) return badRequest('El cuerpo debe ser un objeto JSON.');
    const r = await editarMatriz(guard.user, guard.project, n, datos);
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/matrices/[idMatrix]/editar', error);
  }
}
