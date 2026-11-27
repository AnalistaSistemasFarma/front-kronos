import { prisma } from '../prisma';
import { cleanLabel } from './aggregate';
import { isExcludedCompany } from './constants';
import type { ChannelType, CompanyInternet, CompanyInternetInput, ConnectionType } from './internet';

/**
 * Internet channel of each company (table company_internet, see
 * prisma/manual/2026-11-26-it-dashboard-company-internet.sql). Excluded
 * companies (UNIDOSSIS, ONELATAMONCO, PRUEBAS) are left out.
 */

type Row = {
  companyId: number;
  company: string | null;
  provider: string | null;
  public_ip: string | null;
  subnet_mask: string | null;
  gateway: string | null;
  dns_servers: string | null;
  dns_secondary: string | null;
  bandwidth: string | null;
  channel_type: string | null;
  connection_type: string | null;
  notes: string | null;
  updated_at: Date | null;
  updated_by: string | null;
  registered: number | boolean | null;
};

function toInternet(r: Row): CompanyInternet {
  return {
    companyId: Number(r.companyId),
    company: cleanLabel(r.company, `Empresa ${r.companyId}`),
    provider: r.provider ?? '',
    publicIp: r.public_ip ?? '',
    subnetMask: r.subnet_mask ?? '',
    gateway: r.gateway ?? '',
    dnsServers: r.dns_servers ?? '',
    dns2: r.dns_secondary ?? '',
    bandwidth: r.bandwidth ?? '',
    channelType: (r.channel_type ?? '') as ChannelType | '',
    connectionType: (r.connection_type ?? '') as ConnectionType | '',
    notes: r.notes ?? '',
    registered: Boolean(r.registered),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    updatedBy: r.updated_by ?? null,
  };
}

/** Every (not excluded) company with its internet data, registered or not. */
export async function loadCompanyInternet(): Promise<CompanyInternet[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      c.id_company AS companyId, c.company,
      ci.provider, ci.public_ip, ci.subnet_mask, ci.gateway, ci.dns_servers, ci.dns_secondary, ci.bandwidth,
      ci.channel_type, ci.connection_type, ci.notes, ci.updated_at, ci.updated_by,
      CASE WHEN ci.id_company IS NULL THEN 0 ELSE 1 END AS registered
    FROM company c
    LEFT JOIN company_internet ci ON ci.id_company = c.id_company
    ORDER BY c.company
  `;
  return rows.filter((r) => !isExcludedCompany(r.company)).map(toInternet);
}

/** Company name when it exists and is not excluded; null otherwise. */
export async function findAllowedCompany(companyId: number): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ company: string | null }>>`
    SELECT company FROM company WHERE id_company = ${companyId}
  `;
  if (!rows[0] || isExcludedCompany(rows[0].company)) return null;
  return rows[0].company ?? '';
}

const orNull = (v: string) => (v ? v : null);

export async function saveCompanyInternet(
  companyId: number,
  input: CompanyInternetInput,
  updatedBy: string
): Promise<CompanyInternet | null> {
  await prisma.$executeRaw`
    MERGE company_internet WITH (HOLDLOCK) AS t
    USING (SELECT ${companyId} AS id_company) AS s ON t.id_company = s.id_company
    WHEN MATCHED THEN UPDATE SET
      provider = ${orNull(input.provider)},
      public_ip = ${orNull(input.publicIp)},
      subnet_mask = ${orNull(input.subnetMask)},
      gateway = ${orNull(input.gateway)},
      dns_servers = ${orNull(input.dnsServers)},
      dns_secondary = ${orNull(input.dns2)},
      bandwidth = ${orNull(input.bandwidth)},
      channel_type = ${orNull(input.channelType)},
      connection_type = ${orNull(input.connectionType)},
      notes = ${orNull(input.notes)},
      updated_at = SYSUTCDATETIME(),
      updated_by = ${updatedBy}
    WHEN NOT MATCHED THEN INSERT
      (id_company, provider, public_ip, subnet_mask, gateway, dns_servers, dns_secondary, bandwidth,
       channel_type, connection_type, notes, updated_at, updated_by)
      VALUES (${companyId}, ${orNull(input.provider)}, ${orNull(input.publicIp)}, ${orNull(input.subnetMask)},
              ${orNull(input.gateway)}, ${orNull(input.dnsServers)}, ${orNull(input.dns2)}, ${orNull(input.bandwidth)},
              ${orNull(input.channelType)}, ${orNull(input.connectionType)}, ${orNull(input.notes)},
              SYSUTCDATETIME(), ${updatedBy});
  `;
  const all = await loadCompanyInternet();
  return all.find((c) => c.companyId === companyId) ?? null;
}
