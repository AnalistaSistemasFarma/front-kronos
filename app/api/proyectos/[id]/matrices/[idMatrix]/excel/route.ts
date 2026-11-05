import { NextRequest, NextResponse } from 'next/server';
import { jsonNoStore, NO_STORE, serverError } from '../../../../../../../lib/chat/http';
import { buildContentDisposition } from '../../../../../../../lib/chat/attachments';
import { guardProject } from '../../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../../lib/proyectos/acciones';
import { hojasDeVersion } from '../../../../../../../lib/proyectos/matrices';
import { exportarXlsx } from '../../../../../../../lib/proyectos/matrices-excel';

export const dynamic = 'force-dynamic';

/** Descarga la matriz (versión vigente o ?version=) como .xlsx. Cualquier miembro. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; idMatrix: string }> }) {
  try {
    const { id, idMatrix } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    const n = Number.parseInt(idMatrix, 10);
    const v = Number.parseInt(request.nextUrl.searchParams.get('version') ?? '', 10);
    if (!Number.isInteger(n) || n <= 0) return jsonNoStore({ error: 'Matriz no encontrada.' }, { status: 404 });
    const libro = await hojasDeVersion(guard.project, n, Number.isInteger(v) && v > 0 ? v : undefined);
    const buf = await exportarXlsx(libro.hojas);
    const headers = new Headers(NO_STORE);
    headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    headers.set('Content-Disposition', buildContentDisposition(`${libro.nombre} (v${libro.version}).xlsx`));
    headers.set('X-Content-Type-Options', 'nosniff');
    return new NextResponse(new Uint8Array(buf), { status: 200, headers });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('GET /api/proyectos/[id]/matrices/[idMatrix]/excel', error);
  }
}
