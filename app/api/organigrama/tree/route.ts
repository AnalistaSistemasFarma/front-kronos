import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyAccessForUser } from '../../../../lib/organigrama/access';
import { getJerarquia } from '../../../../lib/organigrama/tree';

/**
 * Jerarquia (plana) de cargos de UNA empresa, validando que el usuario tenga
 * acceso a esa empresa. El cliente arma el arbol con idCargo / idCargoPadre.
 *
 * GET /api/organigrama/tree?companyId=1
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyId = Number(request.nextUrl.searchParams.get('companyId'));
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return NextResponse.json({ error: 'companyId invalido' }, { status: 400 });
    }

    const access = await getCompanyAccessForUser(session.user.email, companyId);
    if (!access) {
      return NextResponse.json(
        { error: 'No tiene acceso al organigrama de esta empresa' },
        { status: 403 }
      );
    }

    const nodes = await getJerarquia(companyId);
    return NextResponse.json({ companyName: access.companyName, nodes });
  } catch (error) {
    console.error('Error fetching organigrama tree:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
