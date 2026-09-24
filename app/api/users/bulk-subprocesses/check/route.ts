import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminPrivileges } from '../../../../../lib/access-control';
import { prisma } from '../../../../../lib/prisma';
import { normalizeSubprocessIds } from '../../../../../lib/process/subprocessAssignments';
import { authOptions } from '../../../auth/[...nextauth]/route';

/**
 * POST /api/users/bulk-subprocesses/check
 * Cobertura de subprocesos por usuario.
 * - companyId > 0: mira esa empresa (y reporta si lo tienen en otras).
 * - companyId 0 / "all": mira todas las empresas.
 */
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
    const rawCompanyId = body.companyId;
    const companyId =
      rawCompanyId === null ||
      rawCompanyId === undefined ||
      rawCompanyId === '' ||
      rawCompanyId === 'all' ||
      Number(rawCompanyId) === 0
        ? 0
        : Number(rawCompanyId);

    const subprocessIds = normalizeSubprocessIds(body.subprocessIds);
    const rawUserIds: unknown[] = Array.isArray(body.userIds) ? body.userIds : [];
    const userIds: string[] = [
      ...new Set(
        rawUserIds
          .map((id: unknown) => String(id ?? '').trim())
          .filter((id: string) => id.length > 0)
      ),
    ];

    if (companyId !== 0 && !Number.isFinite(companyId)) {
      return NextResponse.json({ error: 'Company ID inválido' }, { status: 400 });
    }
    if (subprocessIds.length === 0) {
      return NextResponse.json(
        { error: 'Seleccione al menos un subproceso' },
        { status: 400 }
      );
    }
    if (userIds.length === 0) {
      return NextResponse.json({ error: 'Seleccione al menos un usuario' }, { status: 400 });
    }

    const [users, subprocesses, companyUsers] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      prisma.subprocess.findMany({
        where: { id_subprocess: { in: subprocessIds } },
        select: {
          id_subprocess: true,
          subprocess: true,
          process: { select: { process: true } },
        },
      }),
      prisma.companyUser.findMany({
        where: { id_user: { in: userIds } },
        select: {
          id_user: true,
          id_company_user: true,
          id_company: true,
          company: { select: { company: true } },
        },
      }),
    ]);

    const companyNameById = new Map<number, string>();
    for (const cu of companyUsers) {
      companyNameById.set(cu.id_company, cu.company.company);
    }

    const companyUserIds = companyUsers.map((cu) => cu.id_company_user);
    const assignments =
      companyUserIds.length === 0
        ? []
        : await prisma.subprocessUserCompany.findMany({
            where: {
              id_company_user: { in: companyUserIds },
              id_subprocess: { in: subprocessIds },
            },
            select: {
              id_subprocess: true,
              id_company_user: true,
            },
          });

    const metaByCompanyUser = new Map(
      companyUsers.map((cu) => [
        cu.id_company_user,
        { userId: cu.id_user, companyId: cu.id_company },
      ])
    );

    // userId -> subprocessId -> Set(companyId)
    const presence = new Map<string, Map<number, Set<number>>>();
    for (const assignment of assignments) {
      const meta = metaByCompanyUser.get(assignment.id_company_user);
      if (!meta) continue;
      let bySub = presence.get(meta.userId);
      if (!bySub) {
        bySub = new Map();
        presence.set(meta.userId, bySub);
      }
      let companies = bySub.get(assignment.id_subprocess);
      if (!companies) {
        companies = new Set();
        bySub.set(assignment.id_subprocess, companies);
      }
      companies.add(meta.companyId);
    }

    const subprocessMeta = subprocesses.map((s) => ({
      id: s.id_subprocess,
      name: s.subprocess,
      processName: s.process.process,
    }));
    const nameBySubprocess = new Map(subprocessMeta.map((s) => [s.id, s.name]));

    const scopedCompanyName =
      companyId > 0 ? companyNameById.get(companyId) || null : null;

    // Si pidieron una empresa y nadie de la muestra tiene company_user ahí,
    // igual podemos resolver el nombre desde catálogo.
    let resolvedCompanyName = scopedCompanyName;
    if (companyId > 0 && !resolvedCompanyName) {
      const company = await prisma.company.findUnique({
        where: { id_company: companyId },
        select: { company: true },
      });
      resolvedCompanyName = company?.company ?? null;
    }

    const rows = users
      .map((user) => {
        const bySub = presence.get(user.id) ?? new Map<number, Set<number>>();

        const presentIdsGlobal = subprocessIds.filter((id) => (bySub.get(id)?.size ?? 0) > 0);
        const presentIdsInCompany =
          companyId > 0
            ? subprocessIds.filter((id) => bySub.get(id)?.has(companyId) ?? false)
            : presentIdsGlobal;

        const presentIds = companyId > 0 ? presentIdsInCompany : presentIdsGlobal;
        const missingIds = subprocessIds.filter((id) => !presentIds.includes(id));
        const presentElsewhereIds =
          companyId > 0
            ? presentIdsGlobal.filter((id) => !presentIdsInCompany.includes(id))
            : [];

        const status =
          presentIds.length === 0
            ? ('none' as const)
            : presentIds.length === subprocessIds.length
              ? ('all' as const)
              : ('some' as const);

        const companyIdsForPresent = [
          ...new Set(
            presentIdsGlobal.flatMap((id) => [...(bySub.get(id) ?? new Set<number>())])
          ),
        ];

        return {
          userId: user.id,
          name: user.name,
          email: user.email,
          presentIds,
          missingIds,
          presentIdsGlobal,
          presentElsewhereIds,
          presentNames: presentIds.map((id) => nameBySubprocess.get(id) || String(id)),
          missingNames: missingIds.map((id) => nameBySubprocess.get(id) || String(id)),
          presentElsewhereNames: presentElsewhereIds.map(
            (id) => nameBySubprocess.get(id) || String(id)
          ),
          companies: companyIdsForPresent
            .map((id) => companyNameById.get(id) || `Empresa ${id}`)
            .sort(),
          status,
          hasCount: presentIds.length,
          totalCount: subprocessIds.length,
          hasAnywhere: presentIdsGlobal.length > 0,
        };
      })
      .sort((a, b) => a.email.localeCompare(b.email));

    const summary = {
      all: rows.filter((r) => r.status === 'all').length,
      some: rows.filter((r) => r.status === 'some').length,
      none: rows.filter((r) => r.status === 'none').length,
      hasAnywhere: rows.filter((r) => r.hasAnywhere).length,
      total: rows.length,
      scope: companyId > 0 ? 'company' : 'all',
      companyId: companyId > 0 ? companyId : null,
      companyName: resolvedCompanyName,
    };

    const bySubprocess = subprocessMeta.map((sub) => {
      const withIt = rows.filter((r) => r.presentIds.includes(sub.id)).length;
      const withAnywhere = rows.filter((r) => r.presentIdsGlobal.includes(sub.id)).length;
      return {
        id: sub.id,
        name: sub.name,
        processName: sub.processName,
        withCount: withIt,
        withoutCount: rows.length - withIt,
        withAnywhereCount: withAnywhere,
      };
    });

    return NextResponse.json(
      {
        companyId: companyId > 0 ? companyId : null,
        scope: summary.scope,
        subprocesses: subprocessMeta,
        rows,
        summary,
        bySubprocess,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error checking bulk subprocess coverage:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
