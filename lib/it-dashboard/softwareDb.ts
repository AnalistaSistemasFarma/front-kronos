import { Prisma } from '../../app/generated/prisma';
import { prisma } from '../prisma';
import { cleanLabel } from './aggregate';
import { isExcludedCompany } from './constants';
import { parseEmailList, type LicenseType, type SoftwareInput, type SoftwareItem, type SoftwareKind } from './software';

/**
 * Software and certificates per company (table it_software, see
 * prisma/manual/2026-11-27-it-dashboard-software.sql). Excluded companies are
 * left out.
 */

type Row = {
  id: number;
  companyId: number;
  company: string | null;
  kind: string;
  description: string;
  provider: string | null;
  purchaseDate: Date | null;
  expirationDate: Date | null;
  licenses: number | null;
  assignedTo: string | null;
  cost: number | null;
  licenseType: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  notifyEmails: string | null;
  noticeSentAt: Date | null;
  platformEmail: string | null;
};

const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function toItem(r: Row): SoftwareItem {
  return {
    id: Number(r.id),
    companyId: Number(r.companyId),
    company: cleanLabel(r.company, `Empresa ${r.companyId}`),
    kind: r.kind as SoftwareKind,
    description: r.description ?? '',
    provider: r.provider ?? '',
    purchaseDate: day(r.purchaseDate),
    expirationDate: day(r.expirationDate),
    licenses: r.licenses == null ? null : Number(r.licenses),
    assignedTo: r.assignedTo ?? '',
    cost: r.cost == null ? null : Number(r.cost),
    licenseType: (r.licenseType ?? '') as LicenseType | '',
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    updatedBy: r.updatedBy ?? null,
    notifyEmails: parseEmailList(r.notifyEmails ?? ''),
    noticeSentAt: r.noticeSentAt ? new Date(r.noticeSentAt).toISOString() : null,
    platformEmail: r.platformEmail ?? '',
  };
}

const joinEmails = (list: string[]) => (list.length ? list.join(', ') : null);

/** Software of one company (or every allowed company when companyId is null), by expiration date. */
export async function loadSoftware(companyId: number | null): Promise<SoftwareItem[]> {
  const where = companyId == null ? Prisma.empty : Prisma.sql`WHERE s.id_company = ${companyId}`;
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      s.id, s.id_company AS companyId, c.company, s.kind, s.description, s.provider,
      s.purchase_date AS purchaseDate, s.expiration_date AS expirationDate, s.licenses,
      s.assigned_to AS assignedTo, CAST(s.cost AS float) AS cost, s.license_type AS licenseType,
      s.updated_at AS updatedAt, s.updated_by AS updatedBy,
      s.notify_emails AS notifyEmails, s.notice_sent_at AS noticeSentAt, s.platform_email AS platformEmail
    FROM it_software s
    LEFT JOIN company c ON c.id_company = s.id_company
    ${where}
    ORDER BY CASE WHEN s.expiration_date IS NULL THEN 1 ELSE 0 END, s.expiration_date, s.description
  `);
  return rows.filter((r) => !isExcludedCompany(r.company)).map(toItem);
}

export async function loadSoftwareById(id: number): Promise<SoftwareItem | null> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      s.id, s.id_company AS companyId, c.company, s.kind, s.description, s.provider,
      s.purchase_date AS purchaseDate, s.expiration_date AS expirationDate, s.licenses,
      s.assigned_to AS assignedTo, CAST(s.cost AS float) AS cost, s.license_type AS licenseType,
      s.updated_at AS updatedAt, s.updated_by AS updatedBy,
      s.notify_emails AS notifyEmails, s.notice_sent_at AS noticeSentAt, s.platform_email AS platformEmail
    FROM it_software s
    LEFT JOIN company c ON c.id_company = s.id_company
    WHERE s.id = ${id}
  `;
  return rows[0] ? toItem(rows[0]) : null;
}

const orNull = (v: string) => (v ? v : null);

export async function createSoftware(input: SoftwareInput, user: string): Promise<SoftwareItem | null> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO it_software
      (id_company, kind, description, provider, purchase_date, expiration_date, licenses,
       assigned_to, cost, license_type, notify_emails, platform_email, created_at, created_by, updated_at, updated_by)
    OUTPUT INSERTED.id
    VALUES (${input.companyId}, ${input.kind}, ${input.description}, ${orNull(input.provider)},
            ${orNull(input.purchaseDate)}, ${orNull(input.expirationDate)}, ${input.licenses},
            ${orNull(input.assignedTo)}, ${input.cost}, ${orNull(input.licenseType)},
            ${joinEmails(input.notifyEmails)}, ${orNull(input.platformEmail)}, SYSUTCDATETIME(), ${user}, SYSUTCDATETIME(), ${user})
  `;
  return rows[0] ? loadSoftwareById(Number(rows[0].id)) : null;
}

export async function updateSoftware(id: number, input: SoftwareInput, user: string): Promise<SoftwareItem | null> {
  await prisma.$executeRaw`
    UPDATE it_software SET
      id_company = ${input.companyId},
      kind = ${input.kind},
      description = ${input.description},
      provider = ${orNull(input.provider)},
      purchase_date = ${orNull(input.purchaseDate)},
      expiration_date = ${orNull(input.expirationDate)},
      licenses = ${input.licenses},
      assigned_to = ${orNull(input.assignedTo)},
      cost = ${input.cost},
      license_type = ${orNull(input.licenseType)},
      notify_emails = ${joinEmails(input.notifyEmails)},
      platform_email = ${orNull(input.platformEmail)},
      updated_at = SYSUTCDATETIME(),
      updated_by = ${user}
    WHERE id = ${id}
  `;
  return loadSoftwareById(id);
}
