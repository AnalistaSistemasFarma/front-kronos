import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { badRequest, forbidden, jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { getProjectDetail } from '../../../../../lib/chat/projects';
import { guardProject, notFoundProject } from '../../../../../lib/chat/projects-guard';
import {
  canManageProject,
  normalizeProjectInstructions,
  normalizeProjectName,
} from '../../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * UN proyecto.
 *
 *   GET    detalle (miembros, archivos, conversaciones). Cualquier miembro.
 *   PATCH  { name?, instructions? }. Solo el DUEÑO.
 *   DELETE archiva el proyecto (no borra nada). Solo el DUEÑO.
 *
 * El perfil de conectores y la empresa NO se cambian: cambiar el alcance de
 * datos a mitad de un hilo dejaría una sesión con contexto de otra empresa.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;

    const detalle = await getProjectDetail(guard.project);
    if (!detalle) return notFoundProject();
    return jsonNoStore({ project: detalle });
  } catch (error) {
    return serverError('GET /api/chat/projects/[id]', error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!canManageProject(guard.project.role)) {
      return forbidden('Solo el dueño del proyecto puede cambiarlo.');
    }

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const data: { name?: string; instructions?: string | null } = {};
    if (payload.name !== undefined) {
      const nombre = normalizeProjectName(payload.name);
      if (!nombre.ok) return badRequest(nombre.error);
      data.name = nombre.value;
    }
    if (payload.instructions !== undefined) {
      const instrucciones = normalizeProjectInstructions(payload.instructions);
      if (!instrucciones.ok) return badRequest(instrucciones.error);
      data.instructions = instrucciones.value;
    }
    if (Object.keys(data).length === 0) return badRequest('No hay nada que cambiar.');

    await prisma.chatProject.update({ where: { id_project: guard.project.idProject }, data });

    const detalle = await getProjectDetail({ ...guard.project, name: data.name ?? guard.project.name });
    return jsonNoStore({ project: detalle });
  } catch (error) {
    return serverError('PATCH /api/chat/projects/[id]', error);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!canManageProject(guard.project.role)) {
      return forbidden('Solo el dueño del proyecto puede archivarlo.');
    }

    // Archivar y no borrar: las conversaciones quedan para la auditoría, y el
    // puente deja de atenderlas (su puerta exige archived = 0).
    await prisma.chatProject.update({
      where: { id_project: guard.project.idProject },
      data: { archived: true },
    });
    return jsonNoStore({ archived: true });
  } catch (error) {
    return serverError('DELETE /api/chat/projects/[id]', error);
  }
}
