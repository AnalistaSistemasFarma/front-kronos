import { Prisma } from '../../app/generated/prisma';
import { prisma } from '../prisma';
import { cleanLabel } from './aggregate';
import { isExcludedCompany } from './constants';
import type { ChannelType, CompanyInternet, CompanyInternetInput, ConnectionType } from './internet';

/**
 * Internet channels per company (table company_internet; several rows per
 * company since prisma/manual/2026-11-27-it-dashboard-providers-multiple.sql).
 * Excluded companies (UNIDOSSIS, ONELATAMONCO, PRUEBAS) are left out.
 */

type Row = {
  id: number;
  companyId: number;
  company: string | null;
  label: string | null;
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
};

function toInternet(r: Row): CompanyInternet {
  return {
    id: Number(r.id),
    companyId: Number(r.companyId),
    company: cleanLabel(r.company, `Empresa ${r.companyId}`),
    label: r.label ?? '',
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
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    updatedBy: r.updated_by ?? null,
  };
}

const SELECT = Prisma.sql`
  SELECT ci.id, ci.id_company AS companyId, c.company, ci.label, ci.provider, ci.public_ip, ci.subnet_mask,
         ci.gateway, ci.dns_servers, ci.dns_secondary, ci.bandwidth, ci.channel_type, ci.connection_type,
         ci.notes, ci.updated_at, ci.updated_by
  FROM company_internet ci
  LEFT JOIN company c ON c.id_company = ci.id_company`;

/** Channels of one company, or of every allowed company when companyId is null. */
export async function loadInternet(companyId: number | null): Promise<CompanyInternet[]> {
  const where = companyId == null ? Prisma.empty : Prisma.sql`WHERE ci.id_company = ${companyId}`;
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`${SELECT} ${where} ORDER BY c.company, ci.id`);
  return rows.filter((r) => !isExcludedCompany(r.company)).map(toInternet);
}

export async function loadInternetById(id: number): Promise<CompanyInternet | null> {
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`${SELECT} WHERE ci.id = ${id}`);
  return rows[0] ? toInternet(rows[0]) : null;
}

/** Allowed companies (for the company list and to validate companyId). */
export async function loadAllowedCompanies(): Promise<Array<{ id: number; name: string }>> {
  const rows = await prisma.$queryRaw<Array<{ id: number; name: string | null }>>`
    SELECT id_company AS id, company AS name FROM company ORDER BY company
  `;
  return rows.filter((r) => !isExcludedCompany(r.name)).map((r) => ({ id: Number(r.id), name: cleanLabel(r.name, `Empresa ${r.id}`) }));
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

export async function createInternet(companyId: number, input: CompanyInternetInput, user: string): Promise<CompanyInternet | null> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO company_internet
      (id_company, label, provider, public_ip, subnet_mask, gateway, dns_servers, dns_secondary, bandwidth,
       channel_type, connection_type, notes, updated_at, updated_by)
    OUTPUT INSERTED.id
    VALUES (${companyId}, ${orNull(input.label)}, ${orNull(input.provider)}, ${orNull(input.publicIp)},
            ${orNull(input.subnetMask)}, ${orNull(input.gateway)}, ${orNull(input.dnsServers)}, ${orNull(input.dns2)},
            ${orNull(input.bandwidth)}, ${orNull(input.channelType)}, ${orNull(input.connectionType)},
            ${orNull(input.notes)}, SYSUTCDATETIME(), ${user})
  `;
  return rows[0] ? loadInternetById(Number(rows[0].id)) : null;
}

export async function updateInternet(id: number, input: CompanyInternetInput, user: string): Promise<CompanyInternet | null> {
  await prisma.$executeRaw`
    UPDATE company_internet SET
      label = ${orNull(input.label)},
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
      updated_by = ${user}
    WHERE id = ${id}
  `;
  return loadInternetById(id);
}

export async function deleteInternet(id: number): Promise<boolean> {
  return (await prisma.$executeRaw`DELETE FROM company_internet WHERE id = ${id}`) > 0;
}
