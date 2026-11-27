import { prisma } from '../prisma';
import type { Camera, CameraInput, CameraStatus } from './cameras';

/** Table asset_dvr_camera (prisma/manual/2026-11-27-it-dashboard-dvr-cameras.sql). */

type Row = {
  id: number;
  dvrId: number;
  name: string;
  location: string | null;
  brand: string | null;
  status: string;
  updatedAt: Date | null;
  updatedBy: string | null;
};

const toCamera = (r: Row): Camera => ({
  id: Number(r.id),
  dvrId: Number(r.dvrId),
  name: r.name,
  location: r.location ?? '',
  brand: r.brand ?? '',
  status: r.status as CameraStatus,
  updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
  updatedBy: r.updatedBy ?? null,
});

const orNull = (v: string) => (v ? v : null);

export async function loadCameras(dvrId: number): Promise<Camera[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, id_asset AS dvrId, name, location, brand, status, updated_at AS updatedAt, updated_by AS updatedBy
    FROM asset_dvr_camera
    WHERE id_asset = ${dvrId}
    ORDER BY name
  `;
  return rows.map(toCamera);
}

export async function createCamera(dvrId: number, input: CameraInput, user: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO asset_dvr_camera (id_asset, name, location, brand, status, created_at, created_by, updated_at, updated_by)
    VALUES (${dvrId}, ${input.name}, ${orNull(input.location)}, ${orNull(input.brand)}, ${input.status},
            SYSUTCDATETIME(), ${user}, SYSUTCDATETIME(), ${user})
  `;
}

/** Updates a camera of that DVR; returns false when it does not exist. */
export async function updateCamera(dvrId: number, cameraId: number, input: CameraInput, user: string): Promise<boolean> {
  const n = await prisma.$executeRaw`
    UPDATE asset_dvr_camera SET
      name = ${input.name}, location = ${orNull(input.location)}, brand = ${orNull(input.brand)},
      status = ${input.status}, updated_at = SYSUTCDATETIME(), updated_by = ${user}
    WHERE id = ${cameraId} AND id_asset = ${dvrId}
  `;
  return n > 0;
}

export async function deleteCamera(dvrId: number, cameraId: number): Promise<boolean> {
  const n = await prisma.$executeRaw`DELETE FROM asset_dvr_camera WHERE id = ${cameraId} AND id_asset = ${dvrId}`;
  return n > 0;
}
