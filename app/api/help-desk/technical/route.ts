import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '../../../../lib/prisma';
import { authOptions } from '../../auth/[...nextauth]/route';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await prisma.$queryRaw`
      SELECT 
        suc.id_subprocess_user_company, 
        s.subprocess, 
        suc.id_company_user, 
        u.name
      FROM subprocess_user_company suc
      LEFT JOIN subprocess s ON s.id_subprocess = suc.id_subprocess
      LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
      LEFT JOIN [user] u ON u.id = cu.id_user
      WHERE s.id_subprocess = 1
    `;

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error fetching subprocess users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
