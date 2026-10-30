import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { badRequest, forbidden, jsonNoStore, readJsonBody, serverError } from '../../../../lib/chat/http';
import { getProjectDetail } from '../../../../lib/chat/projects';
import { checkAdminPrivileges } from '../../../../lib/access-control';
import { vinculosDelProyecto } from '../../../../lib/chat/projects-links';
import type { ProyectoDetalleDto } from '../../../../lib/proyectos/tipos';
import { archivedProject, guardProject, notFoundProject } from '../../../../lib/chat/projects-guard';
import {
  capabilitiesFor,
  normalizeProjectDescription,
  normalizeProjectInstructions,
  normalizeProjectName,
} from '../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * UN proyecto.
 *
 *   GET    detalle: agentes, miembros, archivos, conversaciones y vinculados.
 *          Cualquier miembro (un archivado, solo su dueño).
 *   PATCH  { name?, description?, instructions? } solo el DUEÑO.
 *          { archived: false } restaura un archivado (solo el DUEÑO).
 *   DELETE archiva (no borra nada). Solo el DUEÑO.
 *
 * La empresa y el perfil de conectores NO se cambian: cambiar el alcance de
 * datos a mitad de un hilo dejaría sesiones con contexto de otra empresa.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;

    // Administrador de SynerLink (2026-10-29): también renombra y elimina conversaciones. Al dueño no
    // hace falta preguntarle; si la consulta falla, se trata como no administrador (falla cerrado).
    const esAdmin = guard.project.role === 'owner' ? false : await checkAdminPrivileges(guard.user.email).catch(() => false);
    const detalle = await getProjectDetail(guard.user, guard.project, { esAdmin });
    if (!detalle) return notFoundProject();
    const links = await vinculosDelProyecto(guard.project.idProject, {
      user: guard.user,
      role: guard.project.role,
      archived: guard.project.archived,
    });
    // El contrato con la interfaz (lib/proyectos/tipos.ts) lo verifica el compilador.
    const project: ProyectoDetalleDto = { ...detalle, links, linkCount: links.emails.length + links.requests.length };
    return jsonNoStore({ project });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]', error);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id, { allowArchived: true });
    if ('response' in guard) return guard.response;
    if (!capabilitiesFor(guard.project.role).edit) return forbidden('Solo el dueño del proyecto puede cambiarlo.');

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    // Restaurar: lo único que se puede hacer sobre un archivado.
    if (payload.archived === false) {
      if (!guard.project.archived) return jsonNoStore({ archived: false });
      await prisma.chatProject.update({ where: { id_project: guard.project.idProject }, data: { archived: false } });
      return jsonNoStore({ archived: false });
    }
    if (guard.project.archived) return archivedProject();

    const data: { name?: string; description?: string | null; instructions?: string | null } = {};
    if (payload.name !== undefined) {
      const v = normalizeProjectName(payload.name);
      if (!v.ok) return badRequest(v.error);
      data.name = v.value;
    }
    if (payload.description !== undefined) {
      const v = normalizeProjectDescription(payload.description);
      if (!v.ok) return badRequest(v.error);
      data.description = v.value;
    }
    if (payload.instructions !== undefined) {
      const v = normalizeProjectInstructions(payload.instructions);
      if (!v.ok) return badRequest(v.error);
      data.instructions = v.value;
    }
    if (Object.keys(data).length === 0) return badRequest('No hay nada que cambiar.');

    await prisma.chatProject.update({ where: { id_project: guard.project.idProject }, data });
    return jsonNoStore({ updated: true });
  } catch (error) {
    return serverError('PATCH /api/proyectos/[id]', error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!capabilitiesFor(guard.project.role).archive) return forbidden('Solo el dueño del proyecto puede archivarlo.');

    // Archivar y no borrar: las conversaciones quedan para la auditoría, y el
    // puente deja de atenderlas (su puerta exige archived = 0).
    await prisma.chatProject.update({ where: { id_project: guard.project.idProject }, data: { archived: true } });
    return jsonNoStore({ archived: true });
  } catch (error) {
    return serverError('DELETE /api/proyectos/[id]', error);
  }
}
