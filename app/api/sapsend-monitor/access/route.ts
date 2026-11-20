import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { hasSapsendMonitorAccess } from '../../../../lib/sapsend/access';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const canAccess = await hasSapsendMonitorAccess(session.user.email);
  return NextResponse.json({ canAccess });
}
