import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { badRequest, forbidden, jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { eligibleProjectUsers } from '../../../../../../lib/chat/projects';
import { guardProject } from '../../../../../../lib/chat/projects-guard';
import {
  canManageProject,
  canRemoveMember,
  MAX_PROJECT_MEMBERS,
  normalizeInviteIds,
} from '../../../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * MIEMBROS de un proyecto. El DUEÑO administra quién entra.
 *
 *   GET    personas que se pueden invitar (solo el dueño): activas, con el
 *          chat y con el permiso del agente en la empresa del proyecto.
 *   POST   { idUsers: [...] } invita (solo el dueño).
 *   DELETE ?idUser=<id> retira: el dueño a cualquiera menos a sí mismo; un
 *          miembro solo a sí mismo (salir del proyecto).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!canManageProject(guard.project.role)) {
      return forbidden('Solo el dueño del proyecto puede invitar.');
    }

    const [elegibles, actuales] = await Promise.all([
      eligibleProjectUsers(guard.project.idAgent, guard.project.idCompany),
      prisma.chatProjectMember.findMany({
        where: { id_project: guard.project.idProject },
        select: { id_user: true },
      }),
    ]);
    const yaEstan = new Set(actuales.map((m) => m.id_user));

    return jsonNoStore({
      users: elegibles
        .filter((u) => !yaEstan.has(u.id))
        .map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.image })),
    });
  } catch (error) {
    return serverError('GET /api/chat/projects/[id]/members', error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (!canManageProject(guard.project.role)) {
      return forbidden('Solo el dueño del proyecto puede invitar.');
    }

    const payload = await readJsonBody(request);
    const ids = normalizeInviteIds(payload?.idUsers, guard.user.id);
    if (!ids.ok) return badRequest(ids.error);

    const elegibles = new Set(
      (await eligibleProjectUsers(guard.project.idAgent, guard.project.idCompany, ids.value)).map(
        (u) => u.id
      )
    );
    const faltantes = ids.value.filter((x) => !elegibles.has(x));
    if (faltantes.length > 0) {
      return jsonNoStore(
        {
          error:
            'Hay personas que no tienen el asistente habilitado en la empresa del proyecto, así que no podrían entrar. Pida primero el permiso.',
        },
        { status: 409 }
      );
    }

    const actuales = await prisma.chatProjectMember.findMany({
      where: { id_project: guard.project.idProject },
      select: { id_user: true },
    });
    const yaEstan = new Set(actuales.map((m) => m.id_user));
    const nuevos = ids.value.filter((x) => !yaEstan.has(x));
    if (actuales.length + nuevos.length > MAX_PROJECT_MEMBERS) {
      return badRequest(`Un proyecto admite máximo ${MAX_PROJECT_MEMBERS} miembros.`);
    }

    if (nuevos.length > 0) {
      await prisma.chatProjectMember.createMany({
        data: nuevos.map((idUser) => ({
          id_project: guard.project.idProject,
          id_user: idUser,
          role: 'member',
          added_by: guard.user.id,
        })),
      });
    }
    return jsonNoStore({ added: nuevos.length }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/projects/[id]/members', error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;

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
      targetRole: fila.role === 'owner' ? 'owner' : 'member',
    });
    if (!decision.ok) return forbidden(decision.error);

    await prisma.chatProjectMember.delete({ where: { id_project_member: fila.id_project_member } });
    return jsonNoStore({ removed: true });
  } catch (error) {
    return serverError('DELETE /api/chat/projects/[id]/members', error);
  }
}
