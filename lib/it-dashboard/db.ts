import { Prisma } from '../../app/generated/prisma';
import { prisma } from '../prisma';
import type { CatalogItem, ItAssetRow } from './aggregate';
import { EXCLUDED_COMPANY_NAMES, IT_DASHBOARD_LIST_LIMIT, UNASSIGNED_ID } from './constants';

/**
 * Data of the Dashboard TI, read from the same tables as the Activos module
 * (app/api/assets). LEFT JOINs on purpose: an asset without user, company or
 * status still counts in the inventory.
 */

/** One compact row per asset (no serials, users or invoices). */
export async function loadItAssetRows(): Promise<ItAssetRow[]> {
  return prisma.$queryRaw<ItAssetRow[]>`
    SELECT
      a.id                                AS id,
      a.id_company_asset                  AS companyId,
      c.company                           AS company,
      ta.id                               AS typeId,
      ta.type_asset                       AS type,
      a.id_status_asset                   AS statusId,
      sta.status_asset                    AS status,
      CAST(a.equipment_cost AS float)     AS cost
    FROM assets a
    LEFT JOIN subtype_asset sa ON sa.id = a.id_subtype_asset
    LEFT JOIN type_asset ta ON ta.id = sa.id_type_asset
    LEFT JOIN status_asset sta ON sta.id = a.id_status_asset
    LEFT JOIN company c ON c.id_company = a.id_company_asset
  `;
}

/** Companies and asset types for the two panels (every row, even with no assets). */
export async function loadItCatalog(): Promise<{ companies: CatalogItem[]; types: CatalogItem[] }> {
  const [companies, types] = await Promise.all([
    prisma.$queryRaw<CatalogItem[]>`
      SELECT c.id_company AS id, c.company AS name FROM company c ORDER BY c.company
    `,
    prisma.$queryRaw<CatalogItem[]>`
      SELECT ta.id AS id, ta.type_asset AS name FROM type_asset ta ORDER BY ta.id
    `,
  ]);
  return { companies, types };
}

export interface ItAssetListItem {
  id: number;
  name: string | null;
  label: string | null;
  serial: string | null;
  model: string | null;
  type: string | null;
  subtype: string | null;
  user: string | null;
  department: string | null;
  company: string | null;
  status: string | null;
  site: string | null;
  purchaseDate: Date | null;
  /* Detail fields, shown in the asset preview window. */
  processor: string | null;
  ram: string | null;
  storage: string | null;
  os: string | null;
  sim: string | null;
  cost: number | null;
  invoice: string | null;
  renewal: number | null;
  renewalDate: Date | null;
  exitRecord: string | null;
  active: number | null;
  userEmail: string | null;
  userRole: string | null;
}

export interface ItAssetListFilters {
  companyId: number | null;
  typeId: number | null;
  includeRetired: boolean;
}

/** Drill-down: assets of one company and/or type, newest first. */
export async function loadItAssetList(f: ItAssetListFilters): Promise<ItAssetListItem[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`(c.company IS NULL OR UPPER(LTRIM(RTRIM(c.company))) NOT IN (${Prisma.join([...EXCLUDED_COMPANY_NAMES])}))`,
  ];
  if (f.companyId != null) {
    conditions.push(
      f.companyId === UNASSIGNED_ID
        ? Prisma.sql`a.id_company_asset IS NULL`
        : Prisma.sql`a.id_company_asset = ${f.companyId}`
    );
  }
  if (f.typeId != null) {
    conditions.push(
      f.typeId === UNASSIGNED_ID ? Prisma.sql`ta.id IS NULL` : Prisma.sql`ta.id = ${f.typeId}`
    );
  }
  if (!f.includeRetired) {
    conditions.push(Prisma.sql`(sta.status_asset IS NULL OR LTRIM(RTRIM(sta.status_asset)) <> N'Baja')`);
  }

  return prisma.$queryRaw<ItAssetListItem[]>(Prisma.sql`
    SELECT TOP (${IT_DASHBOARD_LIST_LIMIT})
      a.id               AS id,
      a.name             AS name,
      a.label            AS label,
      a.serial           AS serial,
      a.model            AS model,
      ta.type_asset      AS type,
      sa.subtype_asset   AS subtype,
      ua.username_asset  AS [user],
      d.department       AS department,
      c.company          AS company,
      sta.status_asset   AS status,
      a.site             AS site,
      a.purchaseDate     AS purchaseDate,
      a.processor        AS processor,
      a.ram              AS ram,
      a.storage          AS storage,
      a.so               AS os,
      a.sim              AS sim,
      CAST(a.equipment_cost AS float) AS cost,
      a.invoice          AS invoice,
      a.renovation       AS renewal,
      a.date_renovation  AS renewalDate,
      a.out_minute       AS exitRecord,
      a.active           AS active,
      ua.email           AS userEmail,
      ua.rol             AS userRole
    FROM assets a
    LEFT JOIN subtype_asset sa ON sa.id = a.id_subtype_asset
    LEFT JOIN type_asset ta ON ta.id = sa.id_type_asset
    LEFT JOIN user_asset ua ON ua.id = a.id_user_asset
    LEFT JOIN department d ON d.id_department = ua.id_department
    LEFT JOIN status_asset sta ON sta.id = a.id_status_asset
    LEFT JOIN company c ON c.id_company = a.id_company_asset
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY a.id DESC
  `);
}
