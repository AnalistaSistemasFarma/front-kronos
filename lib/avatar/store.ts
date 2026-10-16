import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { MAX_CONFIG_JSON } from './compose';

/**
 * Lectura/escritura de dbo.avatar_config (prisma/manual/2026-10-06-avatar-config.sql).
 *
 * Sin modelo Prisma, a propósito (mismo patrón que chat_agent_metrics): el pase
 * no cambia schema.prisma ni exige `prisma generate` —que en serfarma05 ya
 * tumbó producción por EPERM—, y si la tabla todavía no existe la aplicación
 * sigue igual: el editor avisa "aún no está habilitado" y las fotos de siempre
 * se siguen viendo.
 */

export type AvatarOwnerType = 'user' | 'agent';

export interface AvatarConfigRow {
  configJson: string;
  /** Imagen que tenía antes del primer avatar estilo Notion (para "Quitar"). */
  previousImage: string | null;
  updatedAt: Date;
}

/** La tabla no existe todavía (falta correr el script en esta base). */
export class AvatarStoreUnavailableError extends Error {
  constructor() {
    super('La tabla dbo.avatar_config no existe en esta base.');
    this.name = 'AvatarStoreUnavailableError';
  }
}

/** Error 208 de SQL Server: el objeto no existe. */
function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { number?: number }).number === 208;
}

async function run<T>(fn: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> {
  try {
    return await withMssqlPool(fn);
  } catch (error) {
    if (isMissingTableError(error)) throw new AvatarStoreUnavailableError();
    throw error;
  }
}

export async function readAvatarConfig(ownerType: AvatarOwnerType, ownerId: string): Promise<AvatarConfigRow | null> {
  const r = await run((pool) =>
    pool
      .request()
      .input('owner_type', sql.NVarChar(10), ownerType)
      .input('owner_id', sql.NVarChar(200), ownerId)
      .query(
        'SELECT config_json, previous_image, updated_at FROM dbo.avatar_config WHERE owner_type = @owner_type AND owner_id = @owner_id'
      )
  );
  const f = r.recordset[0] as { config_json: string; previous_image: string | null; updated_at: Date } | undefined;
  if (!f) return null;
  return { configJson: f.config_json, previousImage: f.previous_image, updatedAt: f.updated_at };
}

/** Varias configuraciones de una vez (lista de agentes del Perfil). */
export async function readAvatarConfigs(ownerType: AvatarOwnerType, ownerIds: string[]): Promise<Map<string, AvatarConfigRow>> {
  const mapa = new Map<string, AvatarConfigRow>();
  if (ownerIds.length === 0) return mapa;
  const r = await run((pool) => {
    const req = pool.request().input('owner_type', sql.NVarChar(10), ownerType);
    const marcas = ownerIds.slice(0, 500).map((id, i) => {
      req.input(`id${i}`, sql.NVarChar(200), id);
      return `@id${i}`;
    });
    return req.query(
      `SELECT owner_id, config_json, previous_image, updated_at FROM dbo.avatar_config
       WHERE owner_type = @owner_type AND owner_id IN (${marcas.join(', ')})`
    );
  });
  for (const f of r.recordset as Array<{ owner_id: string; config_json: string; previous_image: string | null; updated_at: Date }>) {
    mapa.set(f.owner_id, { configJson: f.config_json, previousImage: f.previous_image, updatedAt: f.updated_at });
  }
  return mapa;
}

/**
 * Guarda (o reemplaza) la configuración. `previousImage` solo se escribe al
 * CREAR la fila: así "Quitar avatar" siempre vuelve a la foto original, aunque
 * la persona haya guardado varios avatares seguidos.
 */
export async function upsertAvatarConfig(
  ownerType: AvatarOwnerType,
  ownerId: string,
  configJson: string,
  previousImage: string | null,
  updatedBy: string,
  when: Date
): Promise<void> {
  if (configJson.length > MAX_CONFIG_JSON) throw new Error('Configuración de avatar demasiado larga.');
  await run((pool) =>
    pool
      .request()
      .input('owner_type', sql.NVarChar(10), ownerType)
      .input('owner_id', sql.NVarChar(200), ownerId)
      .input('config_json', sql.NVarChar(MAX_CONFIG_JSON), configJson)
      .input('previous_image', sql.NVarChar(1000), previousImage)
      .input('updated_by', sql.NVarChar(255), updatedBy)
      .input('updated_at', sql.DateTime2(3), when).query(`
        UPDATE dbo.avatar_config WITH (UPDLOCK, SERIALIZABLE)
          SET config_json = @config_json, updated_by = @updated_by, updated_at = @updated_at
          WHERE owner_type = @owner_type AND owner_id = @owner_id;
        IF @@ROWCOUNT = 0
          INSERT INTO dbo.avatar_config (owner_type, owner_id, config_json, previous_image, updated_by, updated_at)
          VALUES (@owner_type, @owner_id, @config_json, @previous_image, @updated_by, @updated_at);
      `)
  );
}

export async function deleteAvatarConfig(ownerType: AvatarOwnerType, ownerId: string): Promise<void> {
  await run((pool) =>
    pool
      .request()
      .input('owner_type', sql.NVarChar(10), ownerType)
      .input('owner_id', sql.NVarChar(200), ownerId)
      .query('DELETE FROM dbo.avatar_config WHERE owner_type = @owner_type AND owner_id = @owner_id')
  );
}
