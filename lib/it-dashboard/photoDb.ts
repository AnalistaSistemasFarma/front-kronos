import { prisma } from '../prisma';

/** Table asset_photo (prisma/manual/2026-11-27-it-dashboard-asset-photo.sql). */

export async function assetExists(assetId: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`SELECT id FROM assets WHERE id = ${assetId}`;
  return rows.length > 0;
}

export async function loadAssetPhoto(assetId: number): Promise<{ mime: string; content: Buffer } | null> {
  const rows = await prisma.$queryRaw<Array<{ mime: string; content: Buffer | Uint8Array }>>`
    SELECT mime, content FROM asset_photo WHERE id_asset = ${assetId}
  `;
  if (!rows[0]) return null;
  return { mime: rows[0].mime, content: Buffer.from(rows[0].content) };
}

export async function saveAssetPhoto(assetId: number, mime: string, content: Buffer, user: string): Promise<void> {
  await prisma.$executeRaw`
    MERGE asset_photo WITH (HOLDLOCK) AS t
    USING (SELECT ${assetId} AS id_asset) AS s ON t.id_asset = s.id_asset
    WHEN MATCHED THEN UPDATE SET mime = ${mime}, content = ${content}, updated_at = SYSUTCDATETIME(), updated_by = ${user}
    WHEN NOT MATCHED THEN INSERT (id_asset, mime, content, updated_at, updated_by)
      VALUES (${assetId}, ${mime}, ${content}, SYSUTCDATETIME(), ${user});
  `;
}

export async function deleteAssetPhoto(assetId: number): Promise<void> {
  await prisma.$executeRaw`DELETE FROM asset_photo WHERE id_asset = ${assetId}`;
}
