import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import {
  assertValentineWallAccess,
  parsePreferredCompanyId,
  userCanModerateValentineWall,
} from '@/lib/valentine/access';
import { isValentineWallSeason } from '@/lib/valentine/constants';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = String(session?.user?.email || '')
      .trim()
      .toLowerCase();
    if (!email) {
      return NextResponse.json({ canAccess: false, reason: 'unauthorized' }, { status: 401 });
    }

    if (!isValentineWallSeason()) {
      return NextResponse.json({ canAccess: false, reason: 'off_season' });
    }

    const preferred = parsePreferredCompanyId(
      req.nextUrl.searchParams.get('companyId')
    );
    const access = await assertValentineWallAccess(email, preferred);
    const canModerate = access.ok ? await userCanModerateValentineWall(email) : false;

    return NextResponse.json({
      canAccess: access.ok,
      canModerate,
      reason: access.reason ?? null,
      title: 'Dosis de Amor y Amistad',
      company: access.company ?? null,
      // Solo admins reciben la lista para cambiar de tablero
      companies: canModerate ? access.companies ?? [] : [],
    });
  } catch (err) {
    console.error('[valentine-wall/access]', err);
    return NextResponse.json({ canAccess: false, reason: 'error' }, { status: 500 });
  }
}
