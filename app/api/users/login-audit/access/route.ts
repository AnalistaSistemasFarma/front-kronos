import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { canViewLoginAudit } from '../../../../../lib/auth/login-audit/access';
import { authOptions } from '../../../auth/[...nextauth]/route';

export const dynamic = 'force-dynamic';

/** GET /api/users/login-audit/access → { allowed } para mostrar u ocultar la pestaña. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const allowed = session?.user?.email ? await canViewLoginAudit(session.user.email) : false;
  return NextResponse.json({ allowed }, { headers: { 'Cache-Control': 'no-store' } });
}
