import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getChatAccess } from '../../../../lib/chat/access';
import { checkAdminPrivileges } from '../../../../lib/access-control';

/**
 * Qué agentes puede ver el usuario de la sesión y en qué empresas.
 * Mismo patrón que /api/document-management/access.
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
    // `canBroadcast` es solo para que la interfaz sepa si pintar el botón del
    // mensaje masivo. La reja de verdad vive en POST /api/chat/broadcast: una
    // interfaz que esconde un botón no protege nada.
    const canBroadcast = access.canUseChat
      ? await checkAdminPrivileges(session.user.email)
      : false;
    return NextResponse.json({ ...access, canBroadcast }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Error fetching chat access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
