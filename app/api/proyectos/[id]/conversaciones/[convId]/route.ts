import { NextRequest } from 'next/server';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../lib/chat/projects-guard';
import { errorDeProyecto } from '../../../../../../lib/proyectos/acciones';
import { eliminarHilo, renombrarHilo } from '../../../../../../lib/proyectos/hilos';

export const dynamic = 'force-dynamic';

/**
 * UNA conversación de un proyecto (2026-10-29).
 *
 *   PATCH  { title }  renombra.
 *   DELETE            elimina (borrado LÓGICO: deja de verse y los agentes dejan
 *                     de atenderla; mensajes y adjuntos se conservan).
 *
 * Pueden: quien la creó (si todavía escribe en el proyecto), el dueño del
 * proyecto o un administrador de SynerLink que sea miembro. Cada cambio queda
 * en chat_project_conversation_log (inmutable). Ver lib/proyectos/hilos.ts.
 */
type Ctx = { params: Promise<{ id: string; convId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id, convId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');
    const r = await renombrarHilo(guard.user, guard.project, Number(convId), payload.title);
    return jsonNoStore(r);
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('PATCH /api/proyectos/[id]/conversaciones/[convId]', error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const { id, convId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    const r = await eliminarHilo(guard.user, guard.project, Number(convId));
    return jsonNoStore(r);
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('DELETE /api/proyectos/[id]/conversaciones/[convId]', error);
  }
}
