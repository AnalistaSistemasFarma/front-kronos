import 'server-only';
import sql from 'mssql';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken.jsx';
import { deleteOneDriveItem } from '../onedrive/graphFolderUpload';
import { rejectOrionDocument } from './client';
import { ORION_LEGACY_FILE_ID } from './config';
import { isMissingTableError } from './documentEvents';
import { getOrionDocumentFromBag } from './formValue';
import { insertRequestNote, loadOrionFormBag, upsertOrionFormBag } from './service';

type SqlPool = import('mssql').ConnectionPool;

const ACTIVE_ORION_STATUSES = new Set(['BORRADOR', 'PENDIENTE_FIRMA', 'EN_PROCESO']);

export type DeleteRequestDocumentResult = {
  fileId: string;
  oneDriveDeleted: boolean;
  tasksDeleted: number;
  eventsDeleted: number;
  indexDeleted: number;
  orionDocumentIds: string[];
  /** true si se detuvo el flujo en Orion; null si no había flujo activo. */
  orionStopped: boolean | null;
  orionStopError: string | null;
};

async function deleteByRequestAndFile(
  pool: SqlPool,
  table: 'orion_document_event' | 'orion_document_index',
  requestId: number,
  fileId: string
): Promise<number> {
  try {
    const res = await pool
      .request()
      .input('id_request', sql.Int, requestId)
      .input('file_id', sql.NVarChar(400), fileId)
      .query(`DELETE FROM ${table} WHERE id_request = @id_request AND file_id = @file_id`);
    return Number(res.rowsAffected?.[0] || 0);
  } catch (err) {
    if (isMissingTableError(err)) return 0;
    throw err;
  }
}

/**
 * Borra por completo un documento de la solicitud, sin importar su estado:
 * archivo en OneDrive, estado de firma (versiones, validación, firmantes), tareas de
 * firma / autorización / validación, hoja de vida local e índice. En Orion no existe
 * borrado: si el flujo sigue activo se rechaza para que nadie más pueda firmar.
 * El documento queda en deletedDocuments para que un webhook tardío no lo reviva.
 */
export async function deleteRequestDocumentCompletely(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    fileName?: string | null;
    actorEmail: string;
    actorName?: string | null;
    actorUserId: string;
  }
): Promise<DeleteRequestDocumentResult> {
  const { requestId } = params;
  const fileId = String(params.fileId || '').trim();

  const loaded = await loadOrionFormBag(pool, requestId);
  const state = loaded ? getOrionDocumentFromBag(loaded.bag, fileId) : {};
  const currentDocId = String(state.orionDocumentId || '').trim();
  const orionDocumentIds = [
    ...new Set(
      [
        currentDocId,
        ...(state.supersededDocuments ?? []).map((d) => String(d.orionDocumentId || '').trim()),
      ].filter(Boolean)
    ),
  ];
  const fileName = params.fileName || state.fileName || fileId;

  let orionStopped: boolean | null = null;
  let orionStopError: string | null = null;
  const status = String(state.status || '').toUpperCase();
  if (currentDocId && ACTIVE_ORION_STATUSES.has(status)) {
    try {
      const res = await rejectOrionDocument(currentDocId, {
        email: params.actorEmail,
        reason: `Documento eliminado en SynerLink por ${params.actorName || params.actorEmail}`,
      });
      orionStopped = res.ok;
      if (!res.ok) orionStopError = res.error || `HTTP ${res.status}`;
    } catch (err) {
      orionStopped = false;
      orionStopError = err instanceof Error ? err.message : 'Error de red';
    }
    if (!orionStopped) {
      console.warn(`[orion/delete] No se pudo detener ${currentDocId} en Orion:`, orionStopError);
    }
  }

  let oneDriveDeleted = false;
  if (fileId !== ORION_LEGACY_FILE_ID) {
    const token = await getMicrosoftToken();
    if (!token) {
      throw Object.assign(new Error('No se pudo obtener token de OneDrive'), { status: 502 });
    }
    await deleteOneDriveItem(token, fileId);
    oneDriveDeleted = true;
  }

  const tasks = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('fileMarker', sql.NVarChar(500), `[orionFile:${fileId}]`)
    .input('reviewMarker', sql.NVarChar(500), `[orionReviewFile:${fileId}]`)
    .query(`
      DELETE FROM task_request_general
      WHERE id_request_general = @id_request
        AND (
          CHARINDEX(@fileMarker, ISNULL(resolution, N'')) > 0
          OR CHARINDEX(@reviewMarker, ISNULL(resolution, N'')) > 0
        )
    `);
  const tasksDeleted = Number(tasks.rowsAffected?.[0] || 0);

  const eventsDeleted = await deleteByRequestAndFile(pool, 'orion_document_event', requestId, fileId);
  const indexDeleted = await deleteByRequestAndFile(pool, 'orion_document_index', requestId, fileId);

  if (loaded) {
    const { [fileId]: _removed, ...documents } = loaded.bag.documents;
    const deletedDocuments = [
      ...(loaded.bag.deletedDocuments ?? []).filter((d) => d.fileId !== fileId),
      {
        fileId,
        fileName,
        orionDocumentIds,
        deletedAt: new Date().toISOString(),
        deletedByEmail: params.actorEmail,
      },
    ];
    await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, {
      ...loaded.bag,
      documents,
      deletedDocuments,
    });
  }

  try {
    await insertRequestNote(
      pool,
      requestId,
      `Documento eliminado: ${fileName}. Eliminado por ${params.actorName || params.actorEmail}.`,
      params.actorUserId
    );
  } catch (err) {
    console.warn('[orion/delete] nota de auditoría:', err);
  }

  return {
    fileId,
    oneDriveDeleted,
    tasksDeleted,
    eventsDeleted,
    indexDeleted,
    orionDocumentIds,
    orionStopped,
    orionStopError,
  };
}
