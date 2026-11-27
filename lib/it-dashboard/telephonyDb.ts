import { prisma } from '../prisma';
import { cleanLabel } from './aggregate';
import { isExcludedCompany } from './constants';
import type { CompanyTelephony, CompanyTelephonyInput, TelephonyService } from './telephony';

/** Telephone service per company (table company_telephony, prisma/manual/2026-11-27-it-dashboard-telephony.sql). */

type Row = {
  companyId: number;
  company: string | null;
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
  registered: number | boolean | null;
};

function toTelephony(r: Row): CompanyTelephony {
  return {
    companyId: Number(r.companyId),
    company: cleanLabel(r.company, `Empresa ${r.companyId}`),
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
    registered: Boolean(r.registered),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    updatedBy: r.updated_by ?? null,
  };
}

export async function loadCompanyTelephony(): Promise<CompanyTelephony[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      c.id_company AS companyId, c.company,
      t.provider, t.service_type, t.main_number, t.lines, t.extensions, t.[plan] AS [plan],
      CAST(t.monthly_cost AS float) AS monthly_cost, t.contract_number, t.support_contact, t.notes,
      t.updated_at, t.updated_by,
      CASE WHEN t.id_company IS NULL THEN 0 ELSE 1 END AS registered
    FROM company c
    LEFT JOIN company_telephony t ON t.id_company = c.id_company
    ORDER BY c.company
  `;
  return rows.filter((r) => !isExcludedCompany(r.company)).map(toTelephony);
}

const orNull = (v: string) => (v ? v : null);

export async function saveCompanyTelephony(
  companyId: number,
  input: CompanyTelephonyInput,
  updatedBy: string
): Promise<CompanyTelephony | null> {
  await prisma.$executeRaw`
    MERGE company_telephony WITH (HOLDLOCK) AS t
    USING (SELECT ${companyId} AS id_company) AS s ON t.id_company = s.id_company
    WHEN MATCHED THEN UPDATE SET
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
      updated_by = ${updatedBy}
    WHEN NOT MATCHED THEN INSERT
      (id_company, provider, service_type, main_number, lines, extensions, [plan], monthly_cost,
       contract_number, support_contact, notes, updated_at, updated_by)
      VALUES (${companyId}, ${orNull(input.provider)}, ${orNull(input.serviceType)}, ${orNull(input.mainNumber)},
              ${input.lines}, ${input.extensions}, ${orNull(input.plan)}, ${input.monthlyCost},
              ${orNull(input.contractNumber)}, ${orNull(input.supportContact)}, ${orNull(input.notes)},
              SYSUTCDATETIME(), ${updatedBy});
  `;
  const all = await loadCompanyTelephony();
  return all.find((c) => c.companyId === companyId) ?? null;
}
