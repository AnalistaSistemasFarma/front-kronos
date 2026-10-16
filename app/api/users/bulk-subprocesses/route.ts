import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminPrivileges } from '../../../../lib/access-control';
import { prisma } from '../../../../lib/prisma';
import {
  normalizeSubprocessIds,
  syncUserCompanySubprocesses,
  type SubprocessAssignMode,
} from '../../../../lib/process/subprocessAssignments';
import { authOptions } from '../../auth/[...nextauth]/route';

function normalizeEmailDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/^https?:\/\//, '')
    .split('/')[0];
}

function parseEmails(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw
          .map((v) => String(v || '').trim().toLowerCase())
          .filter((v) => v.includes('@'))
      ),
    ];
  }
  if (typeof raw !== 'string') return [];
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v.includes('@'))
    ),
  ];
}

async function findMatchingUsers(options: {
  emailDomain?: string;
  emails?: string[];
  activeOnly?: boolean;
}) {
  const emailDomain = options.emailDomain ? normalizeEmailDomain(options.emailDomain) : '';
  const emails = options.emails ?? [];
  const activeOnly = options.activeOnly !== false;

  if (!emailDomain && emails.length === 0) {
    return [];
  }

  const baseWhere = activeOnly ? { isActive: true as const } : {};

  if (emails.length > 0 && !emailDomain) {
    return prisma.user.findMany({
      where: { ...baseWhere, email: { in: emails } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
      orderBy: { email: 'asc' },
      take: 500,
    });
  }

  if (emailDomain && emails.length === 0) {
    const users = await prisma.user.findMany({
      where: { ...baseWhere, email: { contains: emailDomain } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
      orderBy: { email: 'asc' },
      take: 500,
    });
    return users.filter((user) => user.email.toLowerCase().includes(emailDomain));
  }

  // Dominio + lista: unión de ambos criterios
  const [byDomain, byEmail] = await Promise.all([
    prisma.user.findMany({
      where: { ...baseWhere, email: { contains: emailDomain } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
      take: 500,
    }),
    prisma.user.findMany({
      where: { ...baseWhere, email: { in: emails } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
      take: 500,
    }),
  ]);

  const map = new Map<string, (typeof byDomain)[number]>();
  for (const user of [...byDomain, ...byEmail]) {
    if (
      user.email.toLowerCase().includes(emailDomain) ||
      emails.includes(user.email.toLowerCase())
    ) {
      map.set(user.id, user);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
}

/** GET — previsualiza usuarios que coinciden con dominio o lista de correos */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPrivileges(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const emailDomain = searchParams.get('emailDomain') || '';
    const emails = parseEmails(searchParams.get('emails') || '');

    if (!emailDomain && emails.length === 0) {
      return NextResponse.json(
        { error: 'Indique un dominio de correo o una lista de emails' },
        { status: 400 }
      );
    }

    const users = await findMatchingUsers({ emailDomain, emails, activeOnly: true });

    return NextResponse.json(
      {
        users,
        count: users.length,
        truncated: users.length >= 500,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error previewing bulk users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST — asigna subprocesos a todos los usuarios coincidentes */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPrivileges(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const companyId = Number(body.companyId);
    const subprocessIds = normalizeSubprocessIds(body.subprocessIds);
    const mode: SubprocessAssignMode =
      body.mode === 'replace' || body.mode === 'remove' ? body.mode : 'add';
    const emailDomain = typeof body.emailDomain === 'string' ? body.emailDomain : '';
    const emails = parseEmails(body.emails);
    const rawUserIds: unknown[] = Array.isArray(body.userIds) ? body.userIds : [];
    const userIds: string[] = [
      ...new Set(
        rawUserIds
          .map((id: unknown) => String(id ?? '').trim())
          .filter((id: string) => id.length > 0)
      ),
    ];

    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 });
    }

    if (subprocessIds.length === 0) {
      return NextResponse.json(
        { error: 'Seleccione al menos un subproceso' },
        { status: 400 }
      );
    }

    const company = await prisma.company.findUnique({
      where: { id_company: companyId },
      select: { id_company: true, company: true },
    });
    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    let targetUsers: { id: string; email: string; name: string | null }[] = [];

    if (userIds.length > 0) {
      targetUsers = await prisma.user.findMany({
        where: { id: { in: userIds }, isActive: true },
        select: { id: true, email: true, name: true },
      });
    } else {
      targetUsers = await findMatchingUsers({ emailDomain, emails, activeOnly: true });
    }

    if (targetUsers.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron usuarios activos para asignar' },
        { status: 404 }
      );
    }

    let successCount = 0;
    let failCount = 0;
    const errors: { userId: string; email: string; error: string }[] = [];
    let totalAdded = 0;
    let totalRemoved = 0;

    for (const user of targetUsers) {
      try {
        const result = await syncUserCompanySubprocesses({
          userId: user.id,
          companyId,
          subprocessIds,
          mode,
        });
        totalAdded += result.added;
        totalRemoved += result.removed;
        successCount += 1;

        await prisma.userAuditLog.create({
          data: {
            user_id: user.id,
            action:
              mode === 'remove' ? 'BULK_REMOVE_SUBPROCESSES' : 'BULK_UPDATE_SUBPROCESSES',
            performed_by: session.user.email,
            details: `Bulk ${mode} company ${companyId}: +${result.added}/-${result.removed}. Final: [${result.finalIds.join(', ')}]`,
          },
        });
      } catch (err) {
        failCount += 1;
        errors.push({
          userId: user.id,
          email: user.email,
          error: err instanceof Error ? err.message : 'Error desconocido',
        });
      }
    }

    return NextResponse.json({
      message:
        mode === 'remove'
          ? 'Retiro masivo de subprocesos completado'
          : 'Asignación masiva completada',
      companyId,
      companyName: company.company,
      mode,
      matched: targetUsers.length,
      successCount,
      failCount,
      totalAdded,
      totalRemoved,
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    console.error('Error in bulk subprocess assignment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
