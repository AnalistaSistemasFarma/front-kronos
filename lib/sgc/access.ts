import type { PrismaClient } from '../../app/generated/prisma';
import { SGC_SUBPROCESS_URLS } from './constants';
import { resolveSgcAccess, type SgcCompanyAccess } from './permissions';

/**
 * Acceso del usuario al SGC documental, leído de la base.
 *
 * Recibe el cliente Prisma como parámetro (en vez de importar el singleton)
 * para que la ruta use el de la app y las pruebas de integración usen uno
 * apuntando al SQL Server efímero de CI.
 */
export type SgcAccessDb = Pick<PrismaClient, 'subprocessUserCompany' | 'sgcCompanyConfig'>;

/** Ids de las empresas con el SGC activado (`sgc.company_config.is_active`). */
export async function getActiveSgcCompanyIds(db: Pick<PrismaClient, 'sgcCompanyConfig'>): Promise<number[]> {
  const rows = await db.sgcCompanyConfig.findMany({
    where: { is_active: true },
    select: { id_company: true },
  });
  return rows.map((r) => r.id_company);
}

/** Acceso efectivo por empresa del usuario con ese correo. */
export async function getSgcAccessForUser(db: SgcAccessDb, userEmail: string): Promise<SgcCompanyAccess[]> {
  const [grants, activeIds] = await Promise.all([
    db.subprocessUserCompany.findMany({
      where: {
        companyUser: { user: { email: userEmail } },
        subprocess: { subprocess_url: { in: Object.values(SGC_SUBPROCESS_URLS) } },
      },
      select: {
        subprocess: { select: { subprocess_url: true } },
        companyUser: { select: { company: { select: { id_company: true, company: true } } } },
      },
    }),
    getActiveSgcCompanyIds(db),
  ]);

  return resolveSgcAccess(
    grants.map((g) => ({
      subprocessUrl: g.subprocess.subprocess_url,
      idCompany: g.companyUser.company.id_company,
      companyName: g.companyUser.company.company,
    })),
    activeIds
  );
}
