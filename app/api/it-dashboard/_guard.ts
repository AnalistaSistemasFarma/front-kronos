import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { canViewItDashboard } from '../../../lib/it-dashboard/access';

/** Session + Dashboard TI subprocess. Returns the user e-mail or a 401/403 response. */
export async function itDashboardUser(): Promise<string | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  if (!(await canViewItDashboard(email))) {
    return NextResponse.json({ error: 'No tiene acceso al Dashboard TI.' }, { status: 403 });
  }
  return email;
}

/** Positive integer from a route / query value, or null. */
export const positiveId = (raw: string | null | undefined): number | null =>
  /^\d+$/.test(raw ?? '') && Number(raw) > 0 && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;

export const NO_STORE = { 'Cache-Control': 'no-store' };
