import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminPrivileges } from '../../../../../lib/access-control';
import { prisma } from '../../../../../lib/prisma';
import { authOptions } from '../../../auth/[...nextauth]/route';

/**
 * Mapeo SAPSEND por empresa de un usuario (company_user.id_user_sapsend e
 * id_department_sapsend). Lo usa SOLO el modulo de compras para escribir
 * U_SEND_UserId y U_SEND_Dep en los borradores (lib/purchases/requester.ts).
 *
 * GET -> una fila por empresa a la que el usuario pertenece.
 * PUT -> { mappings: [{ id_company_user, id_user_sapsend, id_department_sapsend }] }
 *        (null limpia el valor). Solo filas del propio usuario.
 */

type Mapping = {
  id_company_user: number;
  id_user_sapsend: number | null;
  id_department_sapsend: number | null;
};

/** Entero positivo o null. undefined/'' -> null; cualquier otra cosa -> invalido. */
function toOptionalId(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 'invalid';
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!(await checkAdminPrivileges(session.user.email))) {
    return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) };
  }
  return { email: session.user.email };
}

// GET /api/users/[id]/sapsend
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { id: userId } = await params;
    const rows = await prisma.companyUser.findMany({
      where: { id_user: userId },
      select: {
        id_company_user: true,
        id_company: true,
        id_user_sapsend: true,
        id_department_sapsend: true,
        company: { select: { company: true } },
      },
      orderBy: { company: { company: 'asc' } },
    });

    const mappings = rows.map((r) => ({
      id_company_user: r.id_company_user,
      id_company: r.id_company,
      company: r.company.company,
      id_user_sapsend: r.id_user_sapsend,
      id_department_sapsend: r.id_department_sapsend,
    }));

    return NextResponse.json({ mappings }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('Error fetching SAPSEND mapping:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/users/[id]/sapsend
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { id: userId } = await params;
    const body = await request.json().catch(() => ({}));
    const raw = Array.isArray(body.mappings) ? body.mappings : [];

    const mappings: Mapping[] = [];
    for (const m of raw) {
      const idCompanyUser = Number(m?.id_company_user);
      const idUser = toOptionalId(m?.id_user_sapsend);
      const idDep = toOptionalId(m?.id_department_sapsend);
      if (!Number.isInteger(idCompanyUser) || idUser === 'invalid' || idDep === 'invalid') {
        return NextResponse.json(
          { error: 'Los IDs de SAPSEND deben ser enteros positivos o quedar vacios.' },
          { status: 400 }
        );
      }
      mappings.push({ id_company_user: idCompanyUser, id_user_sapsend: idUser, id_department_sapsend: idDep });
    }

    // Solo se aceptan filas que pertenezcan a este usuario.
    const owned = await prisma.companyUser.findMany({
      where: { id_user: userId, id_company_user: { in: mappings.map((m) => m.id_company_user) } },
      select: { id_company_user: true },
    });
    const ownedIds = new Set(owned.map((o) => o.id_company_user));
    if (mappings.some((m) => !ownedIds.has(m.id_company_user))) {
      return NextResponse.json({ error: 'Alguna empresa no pertenece a este usuario.' }, { status: 400 });
    }

    await prisma.$transaction(
      mappings.map((m) =>
        prisma.companyUser.update({
          where: { id_company_user: m.id_company_user },
          data: { id_user_sapsend: m.id_user_sapsend, id_department_sapsend: m.id_department_sapsend },
        })
      )
    );

    await prisma.userAuditLog.create({
      data: {
        user_id: userId,
        action: 'UPDATE',
        performed_by: auth.email,
        details: `Mapeo SAPSEND (compras) actualizado: ${mappings.length} empresa(s)`,
      },
    });

    return NextResponse.json({ count: mappings.length });
  } catch (error) {
    console.error('Error updating SAPSEND mapping:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
