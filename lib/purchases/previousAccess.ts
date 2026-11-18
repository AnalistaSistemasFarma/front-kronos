import { prisma } from '../prisma';
import { getPurchasesAccess } from './access';

/**
 * Empresas en las que el usuario puede ver solicitudes de compra anteriores:
 *  - las SUYAS donde tiene usuario de SAPSEND (company_user.id_user_sapsend);
 *  - TODAS las de la empresa si tiene permiso de lectura de Compras.
 * Solo empresas con conexión SAP activa.
 */
export interface PreviousCompany {
  idCompany: number;
  companyName: string;
  sapsendUserId: number | null;
  canSeeAll: boolean;
}

export async function previousCompanies(email: string): Promise<PreviousCompany[]> {
  const [mappings, access] = await Promise.all([
    prisma.companyUser.findMany({
      where: { user: { email } },
      select: {
        id_company: true,
        id_user_sapsend: true,
        company: { select: { company: true, sap_endpoints: { select: { is_active: true, client: true } } } },
      },
    }),
    getPurchasesAccess(email),
  ]);
  const readable = new Set(access.filter((a) => a.canRead).map((a) => a.idCompany));
  return mappings
    .filter((m) => m.company.sap_endpoints.some((e) => e.is_active && e.client))
    .map((m) => ({
      idCompany: m.id_company,
      companyName: m.company.company.trim(),
      sapsendUserId: m.id_user_sapsend ?? null,
      canSeeAll: readable.has(m.id_company),
    }))
    .filter((c) => c.sapsendUserId != null || c.canSeeAll);
}
