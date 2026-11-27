import { prisma } from '../prisma';
import type { MaintenanceInput, MaintenanceKind, MaintenanceLog } from './maintenance';

/** Table asset_maintenance (prisma/manual/2026-11-27-it-dashboard-maintenance.sql). */

type Row = {
  id: number;
  assetId: number;
  date: Date;
  kind: string;
  notes: string | null;
  createdAt: Date | null;
  createdBy: string | null;
};

const toLog = (r: Row): MaintenanceLog => ({
  id: Number(r.id),
  assetId: Number(r.assetId),
  date: new Date(r.date).toISOString().slice(0, 10),
  kind: r.kind as MaintenanceKind,
  notes: r.notes ?? '',
  createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  createdBy: r.createdBy ?? null,
});

/** Log of an asset, newest maintenance first. */
export async function loadMaintenance(assetId: number): Promise<MaintenanceLog[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, id_asset AS assetId, maintenance_date AS date, kind, notes,
           created_at AS createdAt, created_by AS createdBy
    FROM asset_maintenance
    WHERE id_asset = ${assetId}
    ORDER BY maintenance_date DESC, id DESC
  `;
  return rows.map(toLog);
}

export async function createMaintenance(assetId: number, input: MaintenanceInput, user: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO asset_maintenance (id_asset, maintenance_date, kind, notes, created_at, created_by)
    VALUES (${assetId}, CAST(${input.date} AS date), ${input.kind}, ${input.notes || null}, SYSUTCDATETIME(), ${user})
  `;
}
