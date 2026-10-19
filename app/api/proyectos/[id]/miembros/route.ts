import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { badRequest, forbidden, jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { eligibleProjectUsers } from '../../../../../lib/chat/projects';
import { errorDeProyecto, invitarMiembros } from '../../../../../lib/proyectos/acciones';
import { archivedProject, guardProject } from '../../../../../lib/chat/projects-guard';
import {
  canRemoveMember,
  capabilitiesFor,
  isAssignableRole,
  normalizeInviteIds,
  roleFromDb,
} from '../../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * MIEMBROS de un proyecto. El DUEÑO administra quién entra y con qué rol.
 *
 *   GET    ?candidatos=1  personas que se pueden invitar (solo el dueño):
 *          activas y con el permiso del módulo en la empresa del proyecto.
 *   POST   { idUsers: [...], role: 'editor' | 'reader' }  invita (solo el dueño).
 *   PATCH  { idUser, role: 'editor' | 'reader' }  cambia el rol (solo el dueño).
 *   DELETE ?idUser=<id>  retira: el dueño a cualquiera menos a sí mismo; un
 *          editor o lector solo a sí mismo (salir del proyecto).
 */
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!capabilitiesFor(guard.project.role).manageMembers) return forbidden('Solo el dueño del proyecto puede invitar.');

    const [elegibles, actuales] = await Promise.all([
      eligibleProjectUsers(guard.project.idCompany),
      prisma.chatProjectMember.findMany({ where: { id_project: guard.project.idProject }, select: { id_user: true } }),
    ]);
    const yaEstan = new Set(actuales.map((m) => m.id_user));
    return jsonNoStore({
      users: elegibles.filter((u) => !yaEstan.has(u.id)).map((u) => ({ id: u.id, name: u.name, email: u.email })),
    });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/miembros', error);
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!capabilitiesFor(guard.project.role).manageMembers) return forbidden('Solo el dueño del proyecto puede invitar.');

    const payload = await readJsonBody(request);
    const ids = normalizeInviteIds(payload?.idUsers, guard.user.id);
    if (!ids.ok) return badRequest(ids.error);
    const r = await invitarMiembros(guard.user, guard.project, ids.value, payload?.role);
    return jsonNoStore(r, { status: 201 });
  } catch (error) {
    const e = errorDeProyecto(error);
    if (e) return jsonNoStore({ error: e.error }, { status: e.status });
    return serverError('POST /api/proyectos/[id]/miembros', error);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!capabilitiesFor(guard.project.role).manageMembers) return forbidden('Solo el dueño del proyecto puede cambiar roles.');

    const payload = await readJsonBody(request);
    const idUser = typeof payload?.idUser === 'string' ? payload.idUser.trim() : '';
    if (!idUser) return badRequest('Debe indicar a quién (idUser).');
    if (!isAssignableRole(payload?.role)) return badRequest('El rol debe ser editor o lector.');

    const fila = await prisma.chatProjectMember.findFirst({
      where: { id_project: guard.project.idProject, id_user: idUser },
      select: { id_project_member: true, role: true },
    });
    if (!fila) return jsonNoStore({ error: 'Esa persona no está en el proyecto.' }, { status: 404 });
    if (roleFromDb(fila.role) === 'owner') return forbidden('El rol del dueño no se cambia.');

    await prisma.chatProjectMember.update({ where: { id_project_member: fila.id_project_member }, data: { role: payload.role } });
    return jsonNoStore({ updated: true });
  } catch (error) {
    return serverError('PATCH /api/proyectos/[id]/miembros', error);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (guard.project.archived) return archivedProject();

    const idUser = (request.nextUrl.searchParams.get('idUser') ?? '').trim();
    if (!idUser) return badRequest('Debe indicar a quién retirar (idUser).');

    const fila = await prisma.chatProjectMember.findFirst({
      where: { id_project: guard.project.idProject, id_user: idUser },
      select: { id_project_member: true, role: true },
    });
    if (!fila) return jsonNoStore({ error: 'Esa persona no está en el proyecto.' }, { status: 404 });

    const decision = canRemoveMember({
      actorId: guard.user.id,
      actorRole: guard.project.role,
      targetId: idUser,
      targetRole: roleFromDb(fila.role),
    });
    if (!decision.ok) return forbidden(decision.error);

    await prisma.chatProjectMember.delete({ where: { id_project_member: fila.id_project_member } });
    return jsonNoStore({ removed: true });
  } catch (error) {
    return serverError('DELETE /api/proyectos/[id]/miembros', error);
  }
}
