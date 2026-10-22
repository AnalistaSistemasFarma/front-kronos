import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { correoDeps } from '../../../../../../lib/correo/runtime';
import { readClientOrigin } from '../../../../../../lib/sgc/clientOrigin';
import { archivedProject, guardProject } from '../../../../../../lib/chat/projects-guard';
import { buscarHilosPropios, errorDeVinculo, vincularCorreo } from '../../../../../../lib/chat/projects-links';
import { capabilitiesFor, normalizeLinkSummary } from '../../../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * CORREOS del proyecto (lib/chat/projects-links.ts).
 *
 *   GET  ?q=  hilos del buzón PROPIO para escoger (dueño o editor; exige el
 *        permiso del módulo «Correo»). El buzón sale de la sesión.
 *   POST { conversationId, summary? }  vincula un hilo del buzón propio con
 *        su copia mínima. El resumen es lo único del contenido que se comparte.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!capabilitiesFor(guard.project.role).contribute) {
      return jsonNoStore({ error: 'Su rol en el proyecto no permite vincular correos.' }, { status: 403 });
    }
    const q = request.nextUrl.searchParams.get('q') ?? '';
    const data = await buscarHilosPropios(correoDeps(), guard.user, guard.project, q, readClientOrigin(request).clientIp);
    return jsonNoStore(data);
  } catch (error) {
    const e = errorDeVinculo(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('GET /api/proyectos/[id]/vinculos/correos', error);
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
    const resumen = normalizeLinkSummary(payload.summary);
    if (!resumen.ok) return badRequest(resumen.error);

    const r = await vincularCorreo(
      correoDeps(),
      guard.user,
      guard.project,
      { conversationId: payload.conversationId, summary: resumen.value },
      readClientOrigin(request).clientIp
    );
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeVinculo(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/vinculos/correos', error);
  }
}
