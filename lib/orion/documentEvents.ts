import sql from 'mssql';
import { postOrionDocumentEvent } from './client';
import type { OrionDocumentEvent, OrionDocumentEventType } from './documentEventTypes';
import { orionDocumentEventLabel } from './documentEventTypes';

type SqlPool = import('mssql').ConnectionPool;

/** 208 = Invalid object name: la migración orion_document_lifecycle aún no se aplicó. */
export function isMissingTableError(err: unknown): boolean {
  const e = err as { number?: number; originalError?: { info?: { number?: number } } } | null;
  const num = e?.number ?? e?.originalError?.info?.number;
  return num === 208;
}

/** Id idempotente que Orion usa para no duplicar reintentos del mismo evento. */
export function buildOrionEventId(id: number | string): string {
  return `kronos-orion_document_event-${id}`;
}

export type LogOrionDocumentEventInput = {
  requestId: number;
  fileId: string;
  orionDocumentId?: string | null;
  versionLabel?: string | null;
  eventType: OrionDocumentEventType;
  actorEmail?: string | null;
  actorName?: string | null;
  detail?: string | null;
};

/**
 * Registra el evento en SynerLink y lo replica en Orion (hoja de vida).
 * Nunca lanza: la traza no debe bloquear el flujo de firma.
 */
export async function logOrionDocumentEvent(
  pool: SqlPool,
  input: LogOrionDocumentEventInput
): Promise<void> {
  const fileId = String(input.fileId || '').trim();
  if (!fileId || !Number.isInteger(input.requestId) || input.requestId <= 0) return;
  const actorEmail = input.actorEmail?.trim().toLowerCase() || null;
  const createdAt = new Date().toISOString();
  let eventId: string | null = null;

  // orion_document_id queda NULL hasta que Orion confirme la entrega (ver replay).
  try {
    const inserted = await pool
      .request()
      .input('id_request', sql.Int, input.requestId)
      .input('file_id', sql.NVarChar(400), fileId)
      .input('orion_document_id', sql.NVarChar(200), null)
      .input('version_label', sql.NVarChar(20), input.versionLabel || null)
      .input('event_type', sql.NVarChar(60), input.eventType)
      .input('actor_email', sql.NVarChar(320), actorEmail)
      .input('actor_name', sql.NVarChar(400), input.actorName || null)
      .input('detail', sql.NVarChar(sql.MAX), input.detail || null)
      .query(`
        INSERT INTO orion_document_event
          (id_request, file_id, orion_document_id, version_label, event_type, actor_email, actor_name, detail)
        OUTPUT INSERTED.id
        VALUES
          (@id_request, @file_id, @orion_document_id, @version_label, @event_type, @actor_email, @actor_name, @detail)
      `);
    const id = inserted.recordset?.[0]?.id;
    if (id != null) eventId = buildOrionEventId(id);
  } catch (err) {
    if (!isMissingTableError(err)) {
      console.warn('[orion] logOrionDocumentEvent SQL:', err);
    }
  }

  if (!input.orionDocumentId) return;
  if (eventId) {
    // Envía este evento y cualquier pendiente anterior (caída de Orion o documento aún sin crear).
    void replayPendingOrionDocumentEvents(pool, {
      requestId: input.requestId,
      fileId,
      orionDocumentId: String(input.orionDocumentId),
    });
    return;
  }
  // Sin tabla local (migración pendiente): envío directo, sin idempotencia.
  void postOrionDocumentEvent(String(input.orionDocumentId), {
    type: input.eventType,
    label: orionDocumentEventLabel(input.eventType),
    versionLabel: input.versionLabel || null,
    actorEmail,
    actorName: input.actorName || null,
    detail: input.detail || null,
    synerlinkRequestId: input.requestId,
    fileId,
    occurredAt: createdAt,
  }).catch(() => undefined);
}

export function fireAndForgetOrionDocumentEvent(
  pool: SqlPool,
  input: LogOrionDocumentEventInput
): void {
  void logOrionDocumentEvent(pool, input);
}

/**
 * Eventos registrados antes de existir el documento en Orion (p. ej. validación
 * jurídica): se envían a Orion al crearlo para que la hoja de vida quede completa.
 */
export async function replayPendingOrionDocumentEvents(
  pool: SqlPool,
  params: { requestId: number; fileId: string; orionDocumentId: string }
): Promise<void> {
  try {
    const result = await pool
      .request()
      .input('id_request', sql.Int, params.requestId)
      .input('file_id', sql.NVarChar(400), params.fileId)
      .query(`
        SELECT id, version_label, event_type, actor_email, actor_name, detail, created_at
        FROM orion_document_event
        WHERE id_request = @id_request AND file_id = @file_id AND orion_document_id IS NULL
        ORDER BY created_at ASC, id ASC
      `);
    if (result.recordset.length === 0) return;

    const delivered: number[] = [];
    for (const row of result.recordset) {
      const res = await postOrionDocumentEvent(params.orionDocumentId, {
        eventId: buildOrionEventId(row.id),
        type: String(row.event_type),
        label: orionDocumentEventLabel(String(row.event_type)),
        versionLabel: row.version_label ?? null,
        actorEmail: row.actor_email ?? null,
        actorName: row.actor_name ?? null,
        detail: row.detail ?? null,
        synerlinkRequestId: params.requestId,
        fileId: params.fileId,
        occurredAt: new Date(row.created_at).toISOString(),
      }).catch(() => null);
      // 200 duplicate también cuenta: Orion ya lo tenía.
      if (res?.ok) delivered.push(Number(row.id));
    }
    if (delivered.length === 0) return;

    await pool
      .request()
      .input('orion_document_id', sql.NVarChar(200), params.orionDocumentId)
      .query(`
        UPDATE orion_document_event
        SET orion_document_id = @orion_document_id
        WHERE id IN (${delivered.map((id) => Math.trunc(id)).join(',')})
      `);
  } catch (err) {
    if (!isMissingTableError(err)) {
      console.warn('[orion] replayPendingOrionDocumentEvents:', err);
    }
  }
}

export async function listOrionDocumentEvents(
  pool: SqlPool,
  params: { requestId: number; fileId: string }
): Promise<OrionDocumentEvent[]> {
  try {
    const result = await pool
      .request()
      .input('id_request', sql.Int, params.requestId)
      .input('file_id', sql.NVarChar(400), params.fileId)
      .query(`
        SELECT id, id_request, file_id, orion_document_id, version_label, event_type,
               actor_email, actor_name, detail, created_at
        FROM orion_document_event
        WHERE id_request = @id_request AND file_id = @file_id
        ORDER BY created_at ASC, id ASC
      `);
    return result.recordset.map((row) => ({
      id: Number(row.id),
      requestId: Number(row.id_request),
      fileId: String(row.file_id),
      orionDocumentId: row.orion_document_id ?? null,
      versionLabel: row.version_label ?? null,
      eventType: String(row.event_type),
      actorEmail: row.actor_email ?? null,
      actorName: row.actor_name ?? null,
      detail: row.detail ?? null,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}
