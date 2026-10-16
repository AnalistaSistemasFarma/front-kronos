import 'server-only';
import type { ConnectionPool } from 'mssql';
import { sql } from '../mssqlPool';
import type { DraftBlock } from './draftDiff';

/**
 * Tablero del documento Word (docs/orion-borrador-word-diseno.md): marcas, respuestas,
 * eventos en tiempo real, presencia y caché de párrafos por subversión.
 * Las tablas se crean solas la primera vez (mismo patrón que lib/valentine/db.ts).
 */

export type DraftMarkType = 'correccion' | 'sugerencia' | 'pregunta';
export type DraftMarkStatus = 'abierta' | 'corregida' | 'respondida' | 'confirmada';

export type DraftMarkReply = {
  id: number;
  authorEmail: string;
  authorName: string | null;
  text: string;
  createdAt: string;
};

export type DraftMark = {
  id: number;
  number: number;
  type: DraftMarkType;
  quote: string;
  suggest: string | null;
  why: string;
  createdVersion: string;
  /** Subversión en la que está anclada (se mueve al subir una nueva). */
  anchorVersion: string;
  blockIndex: number;
  authorEmail: string;
  authorName: string | null;
  status: DraftMarkStatus;
  fixedIn: string | null;
  fixedQuote: string | null;
  autoDetected: boolean;
  createdAt: string;
  updatedAt: string;
  replies: DraftMarkReply[];
};

export type DraftPresence = { email: string; name: string | null; typingBlock: number | null };

type Pool = ConnectionPool;

let ensurePromise: Promise<void> | null = null;

export async function ensureDraftBoardTables(pool: Pool): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'orion_draft_mark')
        BEGIN
          CREATE TABLE orion_draft_mark (
            id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            request_id INT NOT NULL,
            file_id NVARCHAR(200) NOT NULL,
            number INT NOT NULL,
            type NVARCHAR(20) NOT NULL,
            quote NVARCHAR(2000) NOT NULL,
            suggest NVARCHAR(2000) NULL,
            why NVARCHAR(2000) NOT NULL,
            created_version NVARCHAR(20) NOT NULL,
            anchor_version NVARCHAR(20) NOT NULL,
            block_index INT NOT NULL,
            author_user_id NVARCHAR(64) NOT NULL,
            author_email NVARCHAR(255) NOT NULL,
            author_name NVARCHAR(255) NULL,
            status NVARCHAR(20) NOT NULL,
            fixed_in NVARCHAR(20) NULL,
            fixed_quote NVARCHAR(2000) NULL,
            auto_detected BIT NOT NULL CONSTRAINT DF_orion_draft_mark_auto DEFAULT 0,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_orion_draft_mark_created DEFAULT SYSUTCDATETIME(),
            updated_at DATETIME2 NOT NULL CONSTRAINT DF_orion_draft_mark_updated DEFAULT SYSUTCDATETIME()
          );
          CREATE INDEX IX_orion_draft_mark_file ON orion_draft_mark (request_id, file_id);
        END

        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'orion_draft_mark_reply')
        BEGIN
          CREATE TABLE orion_draft_mark_reply (
            id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            mark_id INT NOT NULL,
            author_user_id NVARCHAR(64) NOT NULL,
            author_email NVARCHAR(255) NOT NULL,
            author_name NVARCHAR(255) NULL,
            text NVARCHAR(2000) NOT NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_orion_draft_reply_created DEFAULT SYSUTCDATETIME(),
            CONSTRAINT FK_orion_draft_reply_mark FOREIGN KEY (mark_id) REFERENCES orion_draft_mark(id)
          );
          CREATE INDEX IX_orion_draft_reply_mark ON orion_draft_mark_reply (mark_id);
        END

        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'orion_draft_event')
        BEGIN
          CREATE TABLE orion_draft_event (
            id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            request_id INT NOT NULL,
            file_id NVARCHAR(200) NOT NULL,
            type NVARCHAR(40) NOT NULL,
            payload NVARCHAR(MAX) NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_orion_draft_event_created DEFAULT SYSUTCDATETIME()
          );
          CREATE INDEX IX_orion_draft_event_file ON orion_draft_event (request_id, file_id, id);
        END

        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'orion_draft_presence')
        BEGIN
          CREATE TABLE orion_draft_presence (
            request_id INT NOT NULL,
            file_id NVARCHAR(200) NOT NULL,
            user_email NVARCHAR(255) NOT NULL,
            user_name NVARCHAR(255) NULL,
            typing_block INT NULL,
            last_seen DATETIME2 NOT NULL,
            CONSTRAINT PK_orion_draft_presence PRIMARY KEY (request_id, file_id, user_email)
          );
        END

        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'orion_draft_pdf')
        BEGIN
          CREATE TABLE orion_draft_pdf (
            version_id NVARCHAR(64) NOT NULL PRIMARY KEY,
            pdf_item_id NVARCHAR(200) NOT NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_orion_draft_pdf_created DEFAULT SYSUTCDATETIME()
          );
        END

        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'orion_draft_blocks')
        BEGIN
          CREATE TABLE orion_draft_blocks (
            version_id NVARCHAR(64) NOT NULL PRIMARY KEY,
            item_id NVARCHAR(200) NOT NULL,
            blocks NVARCHAR(MAX) NOT NULL,
            created_at DATETIME2 NOT NULL CONSTRAINT DF_orion_draft_blocks_created DEFAULT SYSUTCDATETIME()
          );
        END
      `);
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

function mapMark(row: Record<string, unknown>): DraftMark {
  return {
    id: Number(row.id),
    number: Number(row.number),
    type: String(row.type) as DraftMarkType,
    quote: String(row.quote ?? ''),
    suggest: row.suggest == null ? null : String(row.suggest),
    why: String(row.why ?? ''),
    createdVersion: String(row.created_version),
    anchorVersion: String(row.anchor_version),
    blockIndex: Number(row.block_index),
    authorEmail: String(row.author_email),
    authorName: row.author_name == null ? null : String(row.author_name),
    status: String(row.status) as DraftMarkStatus,
    fixedIn: row.fixed_in == null ? null : String(row.fixed_in),
    fixedQuote: row.fixed_quote == null ? null : String(row.fixed_quote),
    autoDetected: row.auto_detected === true || Number(row.auto_detected) === 1,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    replies: [],
  };
}

export async function listDraftMarks(pool: Pool, requestId: number, fileId: string): Promise<DraftMark[]> {
  await ensureDraftBoardTables(pool);
  const marks = await pool
    .request()
    .input('rid', sql.Int, requestId)
    .input('fid', sql.NVarChar(200), fileId)
    .query(`SELECT * FROM orion_draft_mark WHERE request_id = @rid AND file_id = @fid ORDER BY number`);
  const list = marks.recordset.map(mapMark);
  if (list.length === 0) return list;
  const replies = await pool
    .request()
    .input('rid', sql.Int, requestId)
    .input('fid', sql.NVarChar(200), fileId)
    .query(`
      SELECT r.* FROM orion_draft_mark_reply r
      INNER JOIN orion_draft_mark m ON m.id = r.mark_id
      WHERE m.request_id = @rid AND m.file_id = @fid
      ORDER BY r.created_at, r.id
    `);
  const byMark = new Map(list.map((m) => [m.id, m]));
  for (const row of replies.recordset) {
    byMark.get(Number(row.mark_id))?.replies.push({
      id: Number(row.id),
      authorEmail: String(row.author_email),
      authorName: row.author_name == null ? null : String(row.author_name),
      text: String(row.text),
      createdAt: iso(row.created_at),
    });
  }
  return list;
}

export async function getDraftMark(pool: Pool, markId: number): Promise<(DraftMark & { requestId: number; fileId: string }) | null> {
  await ensureDraftBoardTables(pool);
  const res = await pool.request().input('id', sql.Int, markId).query(`SELECT * FROM orion_draft_mark WHERE id = @id`);
  const row = res.recordset[0];
  return row ? { ...mapMark(row), requestId: Number(row.request_id), fileId: String(row.file_id) } : null;
}

export async function insertDraftMark(
  pool: Pool,
  params: {
    requestId: number;
    fileId: string;
    type: DraftMarkType;
    quote: string;
    suggest: string | null;
    why: string;
    version: string;
    blockIndex: number;
    author: { userId: string; email: string; name?: string | null };
  }
): Promise<number> {
  await ensureDraftBoardTables(pool);
  const res = await pool
    .request()
    .input('rid', sql.Int, params.requestId)
    .input('fid', sql.NVarChar(200), params.fileId)
    .input('type', sql.NVarChar(20), params.type)
    .input('quote', sql.NVarChar(2000), params.quote)
    .input('suggest', sql.NVarChar(2000), params.suggest)
    .input('why', sql.NVarChar(2000), params.why)
    .input('version', sql.NVarChar(20), params.version)
    .input('block', sql.Int, params.blockIndex)
    .input('uid', sql.NVarChar(64), params.author.userId)
    .input('email', sql.NVarChar(255), params.author.email)
    .input('name', sql.NVarChar(255), params.author.name ?? null)
    .query(`
      INSERT INTO orion_draft_mark
        (request_id, file_id, number, type, quote, suggest, why, created_version, anchor_version,
         block_index, author_user_id, author_email, author_name, status)
      OUTPUT INSERTED.id
      VALUES
        (@rid, @fid,
         (SELECT ISNULL(MAX(number), 0) + 1 FROM orion_draft_mark WITH (UPDLOCK, HOLDLOCK)
            WHERE request_id = @rid AND file_id = @fid),
         @type, @quote, @suggest, @why, @version, @version, @block, @uid, @email, @name, N'abierta')
    `);
  return Number(res.recordset[0]?.id);
}

export async function insertDraftMarkReply(
  pool: Pool,
  params: { markId: number; text: string; author: { userId: string; email: string; name?: string | null } }
): Promise<void> {
  await pool
    .request()
    .input('mid', sql.Int, params.markId)
    .input('uid', sql.NVarChar(64), params.author.userId)
    .input('email', sql.NVarChar(255), params.author.email)
    .input('name', sql.NVarChar(255), params.author.name ?? null)
    .input('text', sql.NVarChar(2000), params.text)
    .query(`
      INSERT INTO orion_draft_mark_reply (mark_id, author_user_id, author_email, author_name, text)
      VALUES (@mid, @uid, @email, @name, @text)
    `);
}

export async function updateDraftMark(
  pool: Pool,
  markId: number,
  patch: {
    status?: DraftMarkStatus;
    fixedIn?: string | null;
    fixedQuote?: string | null;
    autoDetected?: boolean;
    anchorVersion?: string;
    blockIndex?: number;
  }
): Promise<void> {
  const sets: string[] = ['updated_at = SYSUTCDATETIME()'];
  const req = pool.request().input('id', sql.Int, markId);
  if (patch.status !== undefined) {
    sets.push('status = @status');
    req.input('status', sql.NVarChar(20), patch.status);
  }
  if (patch.fixedIn !== undefined) {
    sets.push('fixed_in = @fixedIn');
    req.input('fixedIn', sql.NVarChar(20), patch.fixedIn);
  }
  if (patch.fixedQuote !== undefined) {
    sets.push('fixed_quote = @fixedQuote');
    req.input('fixedQuote', sql.NVarChar(2000), patch.fixedQuote);
  }
  if (patch.autoDetected !== undefined) {
    sets.push('auto_detected = @auto');
    req.input('auto', sql.Bit, patch.autoDetected ? 1 : 0);
  }
  if (patch.anchorVersion !== undefined) {
    sets.push('anchor_version = @anchor');
    req.input('anchor', sql.NVarChar(20), patch.anchorVersion);
  }
  if (patch.blockIndex !== undefined) {
    sets.push('block_index = @block');
    req.input('block', sql.Int, patch.blockIndex);
  }
  // Solo nombres de columna fijos arriba; los valores van siempre como parámetros.
  await req.query(`UPDATE orion_draft_mark SET ${sets.join(', ')} WHERE id = @id`);
}

// ── Eventos (tiempo real entre los procesos de pm2) ─────────────────────────

export async function insertDraftEvent(
  pool: Pool,
  params: { requestId: number; fileId: string; type: string; payload?: unknown }
): Promise<void> {
  await ensureDraftBoardTables(pool);
  await pool
    .request()
    .input('rid', sql.Int, params.requestId)
    .input('fid', sql.NVarChar(200), params.fileId)
    .input('type', sql.NVarChar(40), params.type)
    .input('payload', sql.NVarChar(sql.MAX), params.payload == null ? null : JSON.stringify(params.payload))
    .query(`
      INSERT INTO orion_draft_event (request_id, file_id, type, payload) VALUES (@rid, @fid, @type, @payload);
      -- Limpieza liviana: los eventos solo sirven para avisar a quien está conectado.
      IF (ABS(CHECKSUM(NEWID())) % 50) = 0
        DELETE FROM orion_draft_event WHERE created_at < DATEADD(DAY, -2, SYSUTCDATETIME());
    `);
}

export async function maxDraftEventId(pool: Pool, requestId: number, fileId: string): Promise<number> {
  await ensureDraftBoardTables(pool);
  const res = await pool
    .request()
    .input('rid', sql.Int, requestId)
    .input('fid', sql.NVarChar(200), fileId)
    .query(`SELECT ISNULL(MAX(id), 0) AS id FROM orion_draft_event WHERE request_id = @rid AND file_id = @fid`);
  return Number(res.recordset[0]?.id ?? 0);
}

export async function listDraftEventsSince(
  pool: Pool,
  requestId: number,
  fileId: string,
  afterId: number
): Promise<Array<{ id: number; type: string; payload: unknown }>> {
  const res = await pool
    .request()
    .input('rid', sql.Int, requestId)
    .input('fid', sql.NVarChar(200), fileId)
    .input('after', sql.BigInt, afterId)
    .query(`
      SELECT TOP 100 id, type, payload FROM orion_draft_event
      WHERE request_id = @rid AND file_id = @fid AND id > @after
      ORDER BY id
    `);
  return res.recordset.map((row) => {
    let payload: unknown = null;
    try {
      payload = row.payload ? JSON.parse(String(row.payload)) : null;
    } catch {
      payload = null;
    }
    return { id: Number(row.id), type: String(row.type), payload };
  });
}

// ── Presencia ───────────────────────────────────────────────────────────────

export async function touchDraftPresence(
  pool: Pool,
  params: { requestId: number; fileId: string; email: string; name?: string | null; typingBlock?: number | null }
): Promise<void> {
  await ensureDraftBoardTables(pool);
  await pool
    .request()
    .input('rid', sql.Int, params.requestId)
    .input('fid', sql.NVarChar(200), params.fileId)
    .input('email', sql.NVarChar(255), params.email)
    .input('name', sql.NVarChar(255), params.name ?? null)
    .input('typing', sql.Int, params.typingBlock ?? null)
    .query(`
      MERGE orion_draft_presence AS t
      USING (SELECT @rid AS request_id, @fid AS file_id, @email AS user_email) AS s
        ON t.request_id = s.request_id AND t.file_id = s.file_id AND t.user_email = s.user_email
      WHEN MATCHED THEN UPDATE SET user_name = @name, typing_block = @typing, last_seen = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (request_id, file_id, user_email, user_name, typing_block, last_seen)
        VALUES (@rid, @fid, @email, @name, @typing, SYSUTCDATETIME());
    `);
}

export async function listDraftPresence(pool: Pool, requestId: number, fileId: string): Promise<DraftPresence[]> {
  await ensureDraftBoardTables(pool);
  const res = await pool
    .request()
    .input('rid', sql.Int, requestId)
    .input('fid', sql.NVarChar(200), fileId)
    .query(`
      SELECT user_email, user_name, typing_block FROM orion_draft_presence
      WHERE request_id = @rid AND file_id = @fid AND last_seen > DATEADD(SECOND, -40, SYSUTCDATETIME())
      ORDER BY user_name, user_email
    `);
  return res.recordset.map((row) => ({
    email: String(row.user_email),
    name: row.user_name == null ? null : String(row.user_name),
    typingBlock: row.typing_block == null ? null : Number(row.typing_block),
  }));
}

// ── Hoja (PDF) de cada subversión: se convierte una vez y queda en OneDrive ──

export async function getCachedDraftPdfItem(pool: Pool, versionId: string): Promise<string | null> {
  await ensureDraftBoardTables(pool);
  const res = await pool
    .request()
    .input('vid', sql.NVarChar(64), versionId)
    .query(`SELECT pdf_item_id FROM orion_draft_pdf WHERE version_id = @vid`);
  const id = res.recordset[0]?.pdf_item_id;
  return id ? String(id) : null;
}

export async function saveCachedDraftPdfItem(pool: Pool, versionId: string, pdfItemId: string): Promise<void> {
  await pool
    .request()
    .input('vid', sql.NVarChar(64), versionId)
    .input('pid', sql.NVarChar(200), pdfItemId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM orion_draft_pdf WHERE version_id = @vid)
        INSERT INTO orion_draft_pdf (version_id, pdf_item_id) VALUES (@vid, @pid);
    `);
}

// ── Caché de párrafos por subversión (las copias congeladas no cambian) ────

export async function getCachedDraftBlocks(pool: Pool, versionId: string): Promise<DraftBlock[] | null> {
  await ensureDraftBoardTables(pool);
  const res = await pool
    .request()
    .input('vid', sql.NVarChar(64), versionId)
    .query(`SELECT blocks FROM orion_draft_blocks WHERE version_id = @vid`);
  const raw = res.recordset[0]?.blocks;
  if (!raw) return null;
  try {
    return JSON.parse(String(raw)) as DraftBlock[];
  } catch {
    return null;
  }
}

export async function saveCachedDraftBlocks(
  pool: Pool,
  params: { versionId: string; itemId: string; blocks: DraftBlock[] }
): Promise<void> {
  await pool
    .request()
    .input('vid', sql.NVarChar(64), params.versionId)
    .input('item', sql.NVarChar(200), params.itemId)
    .input('blocks', sql.NVarChar(sql.MAX), JSON.stringify(params.blocks))
    .query(`
      IF NOT EXISTS (SELECT 1 FROM orion_draft_blocks WHERE version_id = @vid)
        INSERT INTO orion_draft_blocks (version_id, item_id, blocks) VALUES (@vid, @item, @blocks);
    `);
}
