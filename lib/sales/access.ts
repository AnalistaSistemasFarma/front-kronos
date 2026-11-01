import { prisma } from '../prisma';

/**
 * Permisos del modulo de Ventas por empresa (mismo mecanismo que Compras):
 * filas subprocess_user_company atadas a los subprocesos /process/sales*.
 *   /process/sales         -> ver ofertas
 *   /process/sales/manage  -> crear y enviar ofertas
 * Credenciales SAP solo del lado del servidor.
 */
export const SALES_READ_URL = '/process/sales';
export const SALES_WRITE_URL = '/process/sales/manage';
export const SALES_ADMIN_URL = '/process/sales/automatizacion';

export interface SalesCompanyAccess {
  idCompany: number;
  companyName: string;
  canRead: boolean;
  canWrite: boolean;
  endpoint: { baseUrl: string; username: string; password: string; companyDB: string } | null;
}

export async function getSalesAccess(userEmail: string): Promise<SalesCompanyAccess[]> {
  const rows = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: userEmail } },
      subprocess: { subprocess_url: { in: [SALES_READ_URL, SALES_WRITE_URL] } },
    },
    include: { subprocess: true, companyUser: { include: { company: { include: { sap_endpoints: true } } } } },
  });
  const byCompany = new Map<number, SalesCompanyAccess>();
  for (const row of rows) {
    const company = row.companyUser.company;
    let entry = byCompany.get(company.id_company);
    if (!entry) {
      const ep = company.sap_endpoints.find((e: { is_active: boolean | null }) => e.is_active) ?? company.sap_endpoints[0] ?? null;
      entry = {
        idCompany: company.id_company,
        companyName: company.company,
        canRead: false,
        canWrite: false,
        endpoint: ep ? { baseUrl: ep.base_url, username: ep.username ?? '', password: ep.password ?? '', companyDB: ep.client ?? '' } : null,
      };
      byCompany.set(company.id_company, entry);
    }
    entry.canRead = true;
    if (row.subprocess.subprocess_url === SALES_WRITE_URL) entry.canWrite = true;
  }
  return [...byCompany.values()];
}

export const isReady = (a: SalesCompanyAccess) => Boolean(a.endpoint?.baseUrl && a.endpoint.companyDB);

/** Acceso de UNA empresa (con credenciales, solo servidor) o null si no aplica. */
export async function salesEndpointForUser(userEmail: string, companyId: number, mode: 'read' | 'write' = 'read') {
  const a = (await getSalesAccess(userEmail)).find((x) => x.idCompany === companyId);
  if (!a || (mode === 'read' ? !a.canRead : !a.canWrite) || !isReady(a)) return null;
  return a;
}
