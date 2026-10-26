import { NextRequest } from 'next/server';
import { jsonNoStore, serverError } from '../../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../../lib/chat/projects-guard';
import { errorDeVinculo, quitarVinculo } from '../../../../../../../lib/chat/projects-links';

export const dynamic = 'force-dynamic';

/** DELETE: quita una solicitud del proyecto (el dueño, o quien la vinculó). El caso no cambia. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  try {
    const { id, linkId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    await quitarVinculo(guard.user, guard.project, 'solicitud', Number.parseInt(linkId, 10));
    return jsonNoStore({ removed: true });
  } catch (error) {
    const e = errorDeVinculo(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('DELETE /api/proyectos/[id]/vinculos/solicitudes/[linkId]', error);
  }
}
