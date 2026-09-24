import 'server-only';
import type { ConnectionPool } from 'mssql';
import { sql } from '../mssqlPool';
import {
  VALENTINE_CATEGORIES,
  VALENTINE_MESSAGE_MAX,
  VALENTINE_REACTIONS,
  VALENTINE_TO_NAME_MAX,
  type ValentineCategoryId,
  type ValentineReactionEmoji,
} from './constants';

let ensurePromise: Promise<void> | null = null;

export type ValentinePostRow = {
  id: number;
  message: string;
  categoryId: string;
  toName: string | null;
  createdAt: string;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
};

export async function ensureValentineTables(pool: ConnectionPool): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'valentine_wall_posts')
        BEGIN
          CREATE TABLE valentine_wall_posts (
            id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            id_company INT NOT NULL,
            author_user_id NVARCHAR(64) NOT NULL,
            author_email NVARCHAR(255) NOT NULL,
            author_name NVARCHAR(255) NOT NULL,
            message NVARCHAR(400) NOT NULL,
            category_id NVARCHAR(64) NOT NULL,
            to_name NVARCHAR(255) NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_valentine_posts_created DEFAULT SYSUTCDATETIME(),
            deleted_at DATETIME2 NULL
          );
          CREATE INDEX IX_valentine_posts_company_created
            ON valentine_wall_posts (id_company, created_at DESC);
        END

        IF COL_LENGTH('valentine_wall_posts', 'to_name') IS NULL
        BEGIN
          ALTER TABLE valentine_wall_posts ADD to_name NVARCHAR(255) NULL;
        END

        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'valentine_wall_reactions')
        BEGIN
          CREATE TABLE valentine_wall_reactions (
            id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            post_id INT NOT NULL,
            reactor_user_id NVARCHAR(64) NOT NULL,
            reactor_email NVARCHAR(255) NOT NULL,
            emoji NVARCHAR(16) NOT NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_valentine_react_created DEFAULT SYSUTCDATETIME(),
            CONSTRAINT UQ_valentine_react UNIQUE (post_id, reactor_user_id, emoji),
            CONSTRAINT FK_valentine_react_post
              FOREIGN KEY (post_id) REFERENCES valentine_wall_posts(id)
          );
          CREATE INDEX IX_valentine_react_post ON valentine_wall_reactions (post_id);
        END
      `);
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

function isValidCategory(id: string): id is ValentineCategoryId {
  return VALENTINE_CATEGORIES.some((c) => c.id === id);
}

function isValidReaction(emoji: string): emoji is ValentineReactionEmoji {
  return (VALENTINE_REACTIONS as readonly string[]).includes(emoji);
}

function formatPostDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const raw = String(value);
  const isoDay = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) {
    const [y, m, d] = isoDay.split('-');
    return `${d}/${m}/${y}`;
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function listValentinePosts(
  pool: ConnectionPool,
  viewerUserId: string,
  idCompany: number
): Promise<ValentinePostRow[]> {
  await ensureValentineTables(pool);

  const postsResult = await pool
    .request()
    .input('idCompany', sql.Int, idCompany)
    .query(`
      SELECT TOP 200
        id,
        message,
        category_id AS categoryId,
        to_name AS toName,
        CONVERT(varchar(10), created_at, 23) AS createdAt
      FROM valentine_wall_posts
      WHERE id_company = @idCompany
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `);

  const posts = postsResult.recordset as Array<{
    id: number;
    message: string;
    categoryId: string;
    toName: string | null;
    createdAt: string;
  }>;

  if (posts.length === 0) return [];

  const ids = posts.map((p) => p.id);
  const reactionsResult = await pool.request().query(`
    SELECT
      post_id AS postId,
      emoji,
      reactor_user_id AS reactorUserId
    FROM valentine_wall_reactions
    WHERE post_id IN (${ids.map((n) => Number(n)).join(',')})
  `);

  type ReactRow = { postId: number; emoji: string; reactorUserId: string };
  const reactRows = reactionsResult.recordset as ReactRow[];

  const byPost = new Map<number, Map<string, { count: number; mine: boolean }>>();
  for (const row of reactRows) {
    if (!byPost.has(row.postId)) byPost.set(row.postId, new Map());
    const map = byPost.get(row.postId)!;
    const prev = map.get(row.emoji) || { count: 0, mine: false };
    prev.count += 1;
    if (String(row.reactorUserId) === String(viewerUserId)) prev.mine = true;
    map.set(row.emoji, prev);
  }

  return posts.map((p) => {
    const map = byPost.get(p.id);
    const reactions = map
      ? Array.from(map.entries()).map(([emoji, v]) => ({
          emoji,
          count: v.count,
          mine: v.mine,
        }))
      : [];
    reactions.sort((a, b) => b.count - a.count);
    return {
      id: p.id,
      message: p.message,
      categoryId: p.categoryId,
      toName: p.toName ? String(p.toName).trim() || null : null,
      createdAt: formatPostDate(p.createdAt),
      reactions,
    };
  });
}

export async function createValentinePost(
  pool: ConnectionPool,
  params: {
    idCompany: number;
    authorUserId: string;
    authorEmail: string;
    authorName: string;
    message: string;
    categoryId: string;
    toName?: string | null;
  }
): Promise<ValentinePostRow> {
  await ensureValentineTables(pool);

  const message = String(params.message || '')
    .trim()
    .slice(0, VALENTINE_MESSAGE_MAX);
  if (!message) throw new Error('Mensaje vacío');
  if (!isValidCategory(params.categoryId)) throw new Error('Categoría inválida');

  const rawTo = String(params.toName || '')
    .trim()
    .slice(0, VALENTINE_TO_NAME_MAX);
  const toName = rawTo.length > 0 ? rawTo : null;

  const insert = await pool
    .request()
    .input('idCompany', sql.Int, params.idCompany)
    .input('authorUserId', sql.NVarChar(64), params.authorUserId)
    .input('authorEmail', sql.NVarChar(255), params.authorEmail)
    .input('authorName', sql.NVarChar(255), params.authorName.slice(0, 120))
    .input('message', sql.NVarChar(400), message)
    .input('categoryId', sql.NVarChar(64), params.categoryId)
    .input('toName', sql.NVarChar(255), toName)
    .query(`
      INSERT INTO valentine_wall_posts
        (id_company, author_user_id, author_email, author_name, message, category_id, to_name)
      OUTPUT
        INSERTED.id,
        INSERTED.message,
        INSERTED.category_id AS categoryId,
        INSERTED.to_name AS toName,
        CONVERT(varchar(10), INSERTED.created_at, 23) AS createdAt
      VALUES
        (@idCompany, @authorUserId, @authorEmail, @authorName, @message, @categoryId, @toName)
    `);

  const row = insert.recordset[0] as {
    id: number;
    message: string;
    categoryId: string;
    toName: string | null;
    createdAt: string;
  };
  return {
    id: row.id,
    message: row.message,
    categoryId: row.categoryId,
    toName: row.toName ? String(row.toName).trim() || null : null,
    createdAt: formatPostDate(row.createdAt),
    reactions: [],
  };
}

/** Soft-delete (admin). Marca deleted_at; no borra filas físicas. */
export async function softDeleteValentinePost(
  pool: ConnectionPool,
  postId: number,
  idCompany: number
): Promise<boolean> {
  await ensureValentineTables(pool);
  const result = await pool
    .request()
    .input('postId', sql.Int, postId)
    .input('idCompany', sql.Int, idCompany)
    .query(`
      UPDATE valentine_wall_posts
      SET deleted_at = SYSUTCDATETIME()
      WHERE id = @postId
        AND id_company = @idCompany
        AND deleted_at IS NULL
    `);
  return (result.rowsAffected?.[0] ?? 0) > 0;
}

/** Toggle reacción: si ya existe la misma, la quita; si no, la agrega (máx 1 por emoji/usuario). */
export async function toggleValentineReaction(
  pool: ConnectionPool,
  params: {
    postId: number;
    idCompany: number;
    userId: string;
    email: string;
    emoji: string;
  }
): Promise<{ added: boolean }> {
  await ensureValentineTables(pool);
  if (!isValidReaction(params.emoji)) throw new Error('Reacción inválida');

  const existing = await pool
    .request()
    .input('postId', sql.Int, params.postId)
    .input('userId', sql.NVarChar(64), params.userId)
    .input('emoji', sql.NVarChar(16), params.emoji)
    .query(`
      SELECT TOP 1 id
      FROM valentine_wall_reactions
      WHERE post_id = @postId
        AND reactor_user_id = @userId
        AND emoji = @emoji
    `);

  if (existing.recordset.length > 0) {
    await pool
      .request()
      .input('id', sql.Int, existing.recordset[0].id)
      .query(`DELETE FROM valentine_wall_reactions WHERE id = @id`);
    return { added: false };
  }

  const postOk = await pool
    .request()
    .input('postId', sql.Int, params.postId)
    .input('idCompany', sql.Int, params.idCompany)
    .query(`
      SELECT TOP 1 id FROM valentine_wall_posts
      WHERE id = @postId AND id_company = @idCompany AND deleted_at IS NULL
    `);
  if (!postOk.recordset.length) throw new Error('Mensaje no encontrado');

  await pool
    .request()
    .input('postId', sql.Int, params.postId)
    .input('userId', sql.NVarChar(64), params.userId)
    .input('email', sql.NVarChar(255), params.email)
    .input('emoji', sql.NVarChar(16), params.emoji)
    .query(`
      INSERT INTO valentine_wall_reactions (post_id, reactor_user_id, reactor_email, emoji)
      VALUES (@postId, @userId, @email, @emoji)
    `);
  return { added: true };
}
