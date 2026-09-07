import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getChatAccess } from '../../../../lib/chat/access';

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
    return NextResponse.json(access, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Error fetching chat access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
