import { prisma } from '../prisma';

export type GroupedSubprocessAssignment = {
  companyId: number;
  companyName: string;
  companyUserId: number;
  subprocesses: {
    id: number;
    subprocessId: number;
    subprocessName: string;
    subprocessUrl: string | null;
    processId: number;
    processName: string;
  }[];
};

type CompanyUserWithSubprocesses = {
  id_company: number;
  id_company_user: number;
  company: { company: string };
  subprocesses: Array<{
    id_subprocess_user_company: number;
    id_subprocess: number;
    subprocess: {
      subprocess: string;
      subprocess_url: string | null;
      id_process: number;
      process: { process: string };
    };
  }>;
};

export function groupAssignmentsByCompany(
  companyUsers: CompanyUserWithSubprocesses[]
): GroupedSubprocessAssignment[] {
  const byCompany = new Map<
    number,
    {
      companyId: number;
      companyName: string;
      companyUserId: number;
      subprocesses: Map<
        number,
        GroupedSubprocessAssignment['subprocesses'][number]
      >;
    }
  >();

  for (const cu of companyUsers) {
    let group = byCompany.get(cu.id_company);
    if (!group) {
      group = {
        companyId: cu.id_company,
        companyName: cu.company.company,
        companyUserId: cu.id_company_user,
        subprocesses: new Map(),
      };
      byCompany.set(cu.id_company, group);
    } else if (cu.id_company_user < group.companyUserId) {
      group.companyUserId = cu.id_company_user;
    }

    for (const suc of cu.subprocesses) {
      group.subprocesses.set(suc.id_subprocess, {
        id: suc.id_subprocess_user_company,
        subprocessId: suc.id_subprocess,
        subprocessName: suc.subprocess.subprocess,
        subprocessUrl: suc.subprocess.subprocess_url,
        processId: suc.subprocess.id_process,
        processName: suc.subprocess.process.process,
      });
    }
  }

  return Array.from(byCompany.values()).map((group) => ({
    companyId: group.companyId,
    companyName: group.companyName,
    companyUserId: group.companyUserId,
    subprocesses: Array.from(group.subprocesses.values()),
  }));
}

/**
 * Une filas duplicadas de company_user (mismo usuario + empresa) y consolida
 * sus subprocesos en el registro primario. Evita asignaciones huérfanas.
 */
export async function consolidateDuplicateCompanyUsers(userId: string): Promise<void> {
  const companyUsers = await prisma.companyUser.findMany({
    where: { id_user: userId },
    orderBy: [{ id_company: 'asc' }, { id_company_user: 'asc' }],
    include: { subprocesses: true },
  });

  const byCompany = new Map<number, typeof companyUsers>();
  for (const cu of companyUsers) {
    const list = byCompany.get(cu.id_company) ?? [];
    list.push(cu);
    byCompany.set(cu.id_company, list);
  }

  for (const [, rows] of byCompany) {
    if (rows.length <= 1) continue;

    const [primary, ...duplicates] = rows;

    await prisma.$transaction(async (tx) => {
      const primarySubprocessIds = new Set(primary.subprocesses.map((s) => s.id_subprocess));

      for (const duplicate of duplicates) {
        for (const assignment of duplicate.subprocesses) {
          if (primarySubprocessIds.has(assignment.id_subprocess)) {
            await tx.subprocessUserCompany.delete({
              where: { id_subprocess_user_company: assignment.id_subprocess_user_company },
            });
          } else {
            await tx.subprocessUserCompany.update({
              where: { id_subprocess_user_company: assignment.id_subprocess_user_company },
              data: { id_company_user: primary.id_company_user },
            });
            primarySubprocessIds.add(assignment.id_subprocess);
          }
        }

        await tx.companyUser.delete({
          where: { id_company_user: duplicate.id_company_user },
        });
      }
    });
  }
}

export async function getUserCompanyUsersWithSubprocesses(userId: string) {
  return prisma.companyUser.findMany({
    where: { id_user: userId },
    include: {
      company: true,
      subprocesses: {
        include: {
          subprocess: {
            include: { process: true },
          },
        },
      },
    },
  });
}

/** Solo lectura: unión de subprocesos asignados (incluye filas duplicadas de company_user). */
export async function getAssignedSubprocessIdsForUser(userId: string): Promise<number[]> {
  const assignments = await prisma.subprocessUserCompany.findMany({
    where: { companyUser: { id_user: userId } },
    select: { id_subprocess: true },
  });

  return [...new Set(assignments.map((a) => a.id_subprocess))];
}

export function normalizeSubprocessIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
}

export type SubprocessAssignMode = 'replace' | 'add' | 'remove';

export type SyncUserCompanySubprocessesResult = {
  added: number;
  removed: number;
  finalIds: number[];
};

/**
 * Sincroniza subprocesos de un usuario en una empresa.
 * - replace: deja exactamente los ids indicados
 * - add: une los ids nuevos a los ya asignados (no quita existentes)
 * - remove: quita solo los ids indicados y conserva el resto
 */
export async function syncUserCompanySubprocesses(options: {
  userId: string;
  companyId: number;
  subprocessIds: number[];
  mode?: SubprocessAssignMode;
}): Promise<SyncUserCompanySubprocessesResult> {
  const { userId, companyId, subprocessIds, mode = 'replace' } = options;
  const incomingIds = normalizeSubprocessIds(subprocessIds);

  await consolidateDuplicateCompanyUsers(userId);

  let companyUsers = await prisma.companyUser.findMany({
    where: {
      id_user: userId,
      id_company: companyId,
    },
    orderBy: { id_company_user: 'asc' },
  });

  // En modo remove, si no hay vínculo con la empresa no hay nada que quitar.
  if (companyUsers.length === 0) {
    if (mode === 'remove') {
      return { added: 0, removed: 0, finalIds: [] };
    }
    const created = await prisma.companyUser.create({
      data: {
        id_user: userId,
        id_company: companyId,
      },
    });
    companyUsers = [created];
  }

  const primaryCompanyUser = companyUsers[0];
  const allCompanyUserIds = companyUsers.map((cu) => cu.id_company_user);

  const existingAssignments = await prisma.subprocessUserCompany.findMany({
    where: {
      id_company_user: { in: allCompanyUserIds },
    },
    select: { id_subprocess: true },
  });

  const existingSubprocessIds = [...new Set(existingAssignments.map((a) => a.id_subprocess))];
  const removeSet = new Set(incomingIds);
  const desiredSubprocessIds =
    mode === 'add'
      ? [...new Set([...existingSubprocessIds, ...incomingIds])]
      : mode === 'remove'
        ? existingSubprocessIds.filter((id) => !removeSet.has(id))
        : incomingIds;

  const desiredSet = new Set(desiredSubprocessIds);
  const removed = existingSubprocessIds.filter((id) => !desiredSet.has(id));
  const added = desiredSubprocessIds.filter((id) => !existingSubprocessIds.includes(id));

  await prisma.$transaction(async (tx) => {
    await tx.subprocessUserCompany.deleteMany({
      where: {
        id_company_user: { in: allCompanyUserIds },
      },
    });

    if (desiredSubprocessIds.length > 0) {
      await tx.subprocessUserCompany.createMany({
        data: desiredSubprocessIds.map((subprocessId) => ({
          id_company_user: primaryCompanyUser.id_company_user,
          id_subprocess: subprocessId,
        })),
      });
    }

    if (allCompanyUserIds.length > 1) {
      await tx.companyUser.deleteMany({
        where: {
          id_company_user: { in: allCompanyUserIds.slice(1) },
        },
      });
    }
  });

  return {
    added: added.length,
    removed: removed.length,
    finalIds: desiredSubprocessIds,
  };
}
