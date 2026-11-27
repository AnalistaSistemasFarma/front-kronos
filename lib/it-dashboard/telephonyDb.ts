import { Prisma } from '../../app/generated/prisma';
import { prisma } from '../prisma';
import { cleanLabel } from './aggregate';
import { isExcludedCompany } from './constants';
import type { CompanyTelephony, CompanyTelephonyInput, TelephonyService } from './telephony';

/**
 * Telephone services per company (table company_telephony; several rows per
 * company since prisma/manual/2026-11-27-it-dashboard-providers-multiple.sql).
 */

type Row = {
  id: number;
  companyId: number;
  company: string | null;
  label: string | null;
  provider: string | null;
  service_type: string | null;
  main_number: string | null;
  lines: number | null;
  extensions: number | null;
  plan: string | null;
  monthly_cost: number | null;
  contract_number: string | null;
  support_contact: string | null;
  notes: string | null;
  updated_at: Date | null;
  updated_by: string | null;
};

function toTelephony(r: Row): CompanyTelephony {
  return {
    id: Number(r.id),
    companyId: Number(r.companyId),
    company: cleanLabel(r.company, `Empresa ${r.companyId}`),
    label: r.label ?? '',
    provider: r.provider ?? '',
    serviceType: (r.service_type ?? '') as TelephonyService | '',
    mainNumber: r.main_number ?? '',
    lines: r.lines == null ? null : Number(r.lines),
    extensions: r.extensions == null ? null : Number(r.extensions),
    plan: r.plan ?? '',
    monthlyCost: r.monthly_cost == null ? null : Number(r.monthly_cost),
    contractNumber: r.contract_number ?? '',
    supportContact: r.support_contact ?? '',
    notes: r.notes ?? '',
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    updatedBy: r.updated_by ?? null,
  };
}

const SELECT = Prisma.sql`
  SELECT t.id, t.id_company AS companyId, c.company, t.label, t.provider, t.service_type, t.main_number,
         t.lines, t.extensions, t.[plan] AS [plan], CAST(t.monthly_cost AS float) AS monthly_cost,
         t.contract_number, t.support_contact, t.notes, t.updated_at, t.updated_by
  FROM company_telephony t
  LEFT JOIN company c ON c.id_company = t.id_company`;

export async function loadTelephony(companyId: number | null): Promise<CompanyTelephony[]> {
  const where = companyId == null ? Prisma.empty : Prisma.sql`WHERE t.id_company = ${companyId}`;
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`${SELECT} ${where} ORDER BY c.company, t.id`);
  return rows.filter((r) => !isExcludedCompany(r.company)).map(toTelephony);
}

export async function loadTelephonyById(id: number): Promise<CompanyTelephony | null> {
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`${SELECT} WHERE t.id = ${id}`);
  return rows[0] ? toTelephony(rows[0]) : null;
}

const orNull = (v: string) => (v ? v : null);

export async function createTelephony(companyId: number, input: CompanyTelephonyInput, user: string): Promise<CompanyTelephony | null> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO company_telephony
      (id_company, label, provider, service_type, main_number, lines, extensions, [plan], monthly_cost,
       contract_number, support_contact, notes, updated_at, updated_by)
    OUTPUT INSERTED.id
    VALUES (${companyId}, ${orNull(input.label)}, ${orNull(input.provider)}, ${orNull(input.serviceType)},
            ${orNull(input.mainNumber)}, ${input.lines}, ${input.extensions}, ${orNull(input.plan)}, ${input.monthlyCost},
            ${orNull(input.contractNumber)}, ${orNull(input.supportContact)}, ${orNull(input.notes)},
            SYSUTCDATETIME(), ${user})
  `;
  return rows[0] ? loadTelephonyById(Number(rows[0].id)) : null;
}

export async function updateTelephony(id: number, input: CompanyTelephonyInput, user: string): Promise<CompanyTelephony | null> {
  await prisma.$executeRaw`
    UPDATE company_telephony SET
      label = ${orNull(input.label)},
      provider = ${orNull(input.provider)},
      service_type = ${orNull(input.serviceType)},
      main_number = ${orNull(input.mainNumber)},
      lines = ${input.lines},
      extensions = ${input.extensions},
      [plan] = ${orNull(input.plan)},
      monthly_cost = ${input.monthlyCost},
      contract_number = ${orNull(input.contractNumber)},
      support_contact = ${orNull(input.supportContact)},
      notes = ${orNull(input.notes)},
      updated_at = SYSUTCDATETIME(),
      updated_by = ${user}
    WHERE id = ${id}
  `;
  return loadTelephonyById(id);
}

export async function deleteTelephony(id: number): Promise<boolean> {
  return (await prisma.$executeRaw`DELETE FROM company_telephony WHERE id = ${id}`) > 0;
}
