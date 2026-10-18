import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { archivedProject, guardProject } from '../../../../../../lib/chat/projects-guard';
import { buscarSolicitudesVisibles, errorDeVinculo, vincularSolicitud } from '../../../../../../lib/chat/projects-links';
import { capabilitiesFor } from '../../../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * SOLICITUDES del proyecto (lib/chat/projects-links.ts).
 *
 *   GET  ?q=  casos de la empresa del proyecto en los que la persona participa.
 *   POST { idRequest }  vincula un caso que la persona ve (si no, 404).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!capabilitiesFor(guard.project.role).contribute) {
      return jsonNoStore({ error: 'Su rol en el proyecto no permite vincular solicitudes.' }, { status: 403 });
    }
    const requests = await buscarSolicitudesVisibles(guard.user, guard.project, request.nextUrl.searchParams.get('q') ?? '');
    return jsonNoStore({ requests });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/vinculos/solicitudes', error);
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (guard.project.archived) return archivedProject();
    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const r = await vincularSolicitud(guard.user, guard.project, payload.idRequest);
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeVinculo(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/vinculos/solicitudes', error);
  }
}
