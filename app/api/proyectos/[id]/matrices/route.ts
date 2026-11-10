import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readMessageRequest, rejectOversizedBody, serverError } from '../../../../../lib/chat/http';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../lib/proyectos/acciones';
import { listarMatrices, subirMatrizPersona } from '../../../../../lib/proyectos/matrices';

export const dynamic = 'force-dynamic';

/**
 * MATRICES del proyecto (2026-11-05, docs/proyectos-matrices-dashboards.md). Permisos del proyecto.
 *
 *   GET   -> { matrices }   (cualquier miembro)
 *   POST  multipart/form-data: `file` (.xlsx/.csv, 25 MB), opcionales `idMatrix` (versión nueva),
 *         `nombre`, `descripcion`, `filaEncabezados` (1 = primera fila).   (dueño o editor)
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    return jsonNoStore({ matrices: await listarMatrices(guard.project) });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/matrices', error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const oversized = rejectOversizedBody(request);
    if (oversized) return oversized;
    const payload = await readMessageRequest(request);
    const form = payload?.form;
    const file = form?.get('file');
    if (!form || !(file instanceof File)) return badRequest('Envíe el archivo como multipart/form-data (campo file).');
    const num = (k: string) => {
      const v = form.get(k);
      const n = typeof v === 'string' && v.trim() ? Number.parseInt(v, 10) : NaN;
      return Number.isInteger(n) && n > 0 ? n : null;
    };
    const texto = (k: string) => {
      const v = form.get(k);
      return typeof v === 'string' ? v : null;
    };
    const r = await subirMatrizPersona(guard.user, guard.project, {
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      idMatrix: num('idMatrix'),
      nombre: texto('nombre'),
      descripcion: texto('descripcion'),
      filaEncabezados: num('filaEncabezados'),
    });
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/matrices', error);
  }
}
