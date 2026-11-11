import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { NO_STORE, canManageApiClients } from '@/lib/api-permissions/access';
import { authOptions } from '../../../auth/[...nextauth]/route';

export const dynamic = 'force-dynamic';

/** GET /api/administration/api-clients/access → { allowed } para mostrar u ocultar la pestaña «Permisos API». */
export async function GET() {
  const session = await getServerSession(authOptions);
  const allowed = session?.user?.email ? await canManageApiClients(session.user.email) : false;
  return NextResponse.json({ allowed }, { headers: NO_STORE });
}
