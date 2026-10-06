import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getChatAccess } from '../../../../lib/chat/access';
import { checkAdminPrivileges } from '../../../../lib/access-control';
import { prisma } from '../../../../lib/prisma';
import { canStartPeopleChats } from '../../../../lib/chat/people';

/**
 * Qué agentes puede ver el usuario de la sesión y en qué empresas.
 * Mismo patrón que /api/organigrama/access.
 *
 * Seguridad: valida sesión con getServerSession(authOptions) y resuelve TODO
 * a partir del correo de la sesión — el cliente no manda ningún identificador
 * de usuario, así que no hay nada que suplantar.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getChatAccess(session.user.email);
    // `canBroadcast` y `canCreateGroups` son solo para que la interfaz sepa si
    // pintar el botón del mensaje masivo y el de crear grupo. Las rejas de
    // verdad viven en POST /api/chat/broadcast y POST /api/chat/groups: una
    // interfaz que esconde un botón no protege nada.
    //
    // El mensaje masivo sigue siendo de administradores (checkAdminPrivileges).
    // Crear grupos, desde el 2026-10-06 (decisión de Nicolás), es de cualquiera
    // con el chat que tenga al menos un agente asignado: un grupo necesita un
    // asistente y solo puede llevar los propios.
    const canBroadcast = access.canUseChat
      ? await checkAdminPrivileges(session.user.email)
      : false;
    const canCreateGroups = access.canUseChat && access.agents.length > 0;
    // Piloto "Personas" (D2): solo pinta la sección con su buscador. La reja
    // de verdad está en /api/chat/people/*.
    let canMessagePeople = false;
    if (access.canUseChat) {
      const yo = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
      });
      canMessagePeople = yo ? await canStartPeopleChats(yo.id) : false;
    }
    return NextResponse.json({ ...access, canBroadcast, canCreateGroups, canMessagePeople }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Error fetching chat access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
