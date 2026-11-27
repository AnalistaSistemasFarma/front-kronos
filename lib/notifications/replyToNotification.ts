/**
 * Quick reply from a bell notification card (2026-11-24, msg 38376): posts the text as a NOTE on
 * the request or ticket the notification points to.
 *
 * Security:
 *   - The author is the SESSION user (id resolved on the server), never an id from the client.
 *   - The notification must belong to that user (same e-mail): you can only reply to a request or
 *     ticket SynerLink itself notified you about, which is stricter than the note endpoints the
 *     pages use today (/api/requests-general/notes and /api/help-desk/notes take `created_by`
 *     from the body).
 *   - The target is re-derived from the STORED notification URL (replyTarget.ts) and must exist.
 * The note goes into the same `notes` table the request/ticket pages read. The notification is
 * marked as read (replying acknowledges it).
 */
import { MAX_NOTE_REPLY_CHARS, notificationReplyTarget } from './replyTarget';

/** The slice of mssql the function needs (pool.request().input().query()). */
export interface SqlRequestLike {
  input(name: string, type: unknown, value: unknown): SqlRequestLike;
  query(text: string): Promise<{ recordset: Record<string, unknown>[] }>;
}
export interface SqlPoolLike {
  request(): SqlRequestLike;
}
export interface SqlTypes {
  Int: unknown;
  NVarChar: (len?: unknown) => unknown;
  Text: unknown;
  MAX: unknown;
}

export type ReplyResult =
  | { ok: true; kind: 'request' | 'ticket'; targetId: number; noteId: number }
  | { ok: false; status: 400 | 404 | 422; error: string };

export function normalizeNoteText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > MAX_NOTE_REPLY_CHARS) return null;
  return text;
}

export async function replyToNotification(
  pool: SqlPoolLike,
  sql: SqlTypes,
  user: { id: string; email: string },
  notificationId: number,
  rawText: unknown
): Promise<ReplyResult> {
  const text = normalizeNoteText(rawText);
  if (!text) return { ok: false, status: 400, error: `Escriba una nota de 1 a ${MAX_NOTE_REPLY_CHARS} caracteres.` };
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return { ok: false, status: 404, error: 'La notificación no existe.' };
  }
  const email = user.email.trim().toLowerCase();

  const own = await pool
    .request()
    .input('id', sql.Int, notificationId)
    .input('email', sql.NVarChar(255), email)
    .query(`SELECT id, url FROM notifications WHERE id = @id AND LOWER(LTRIM(RTRIM(email))) = @email`);
  const row = own.recordset[0] as { id: number; url: string | null } | undefined;
  if (!row) return { ok: false, status: 404, error: 'La notificación no existe.' };

  const target = notificationReplyTarget(row.url);
  if (!target) return { ok: false, status: 422, error: 'Esta notificación no admite respuesta. Use Abrir.' };

  let kind: 'request' | 'ticket';
  let targetId: number;
  if (target.kind === 'ticket') {
    const found = await pool.request().input('id', sql.Int, target.id).query(`SELECT id_case FROM [case] WHERE id_case = @id`);
    if (!found.recordset[0]) return { ok: false, status: 404, error: 'El ticket ya no existe.' };
    kind = 'ticket';
    targetId = target.id;
  } else {
    let requestId: number | null = target.kind === 'request' ? target.id : null;
    if (target.kind === 'task') {
      const task = await pool
        .request()
        .input('id', sql.Int, target.id)
        .query(`SELECT id_request_general FROM task_request_general WHERE id = @id`);
      requestId = (task.recordset[0]?.id_request_general as number | undefined) ?? null;
    }
    if (!requestId) return { ok: false, status: 404, error: 'La solicitud ya no existe.' };
    const found = await pool.request().input('id', sql.Int, requestId).query(`SELECT id FROM requests_general WHERE id = @id`);
    if (!found.recordset[0]) return { ok: false, status: 404, error: 'La solicitud ya no existe.' };
    kind = 'request';
    targetId = requestId;
  }

  const column = kind === 'ticket' ? 'id_case' : 'id_request';
  const inserted = await pool
    .request()
    .input('note', sql.Text, text)
    .input('target', sql.Int, targetId)
    .input('createdBy', sql.NVarChar(1000), user.id)
    .query(`INSERT INTO notes (note, ${column}, created_by) OUTPUT INSERTED.id_note VALUES (@note, @target, @createdBy)`);
  const noteId = Number(inserted.recordset[0]?.id_note ?? 0);

  await pool
    .request()
    .input('id', sql.Int, notificationId)
    .input('email', sql.NVarChar(255), email)
    .query(
      `UPDATE notifications SET read_at = GETUTCDATE() WHERE id = @id AND LOWER(LTRIM(RTRIM(email))) = @email AND read_at IS NULL`
    );

  return { ok: true, kind, targetId, noteId };
}
