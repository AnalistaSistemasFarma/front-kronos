import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '../../../../../lib/prisma';
import { TEAM_TASKS_NAME, TEAM_TASKS_URL } from '@/lib/request-general/teamTasksAccess';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id != null ? String(session.user.id) : '';
    if (!userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const grants = await prisma.subprocessUserCompany.findMany({
      where: {
        companyUser: { id_user: userId },
        subprocess: {
          OR: [{ subprocess_url: TEAM_TASKS_URL }, { subprocess: TEAM_TASKS_NAME }],
        },
      },
      select: { companyUser: { select: { id_company: true } } },
    });

    const grants2 = await prisma.departmentUser.findMany({
      where: {
        id_user: userId ,
      },
      select: { id_department: true, department: { select: { department: true } } },
    });

    const companies = [...new Set(grants.map((g) => g.companyUser.id_company))];
    const departments = grants2.map((g) => ({ id_department: g.id_department, department: g.department.department }));

    return NextResponse.json({ canViewTeam: companies.length > 0, companies, departments });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
