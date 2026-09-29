import 'server-only';
import sql from 'mssql';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken.jsx';
import {
  deleteOneDriveItem,
  getOneDriveItemMeta,
  isOneDriveItemInFolder,
  listOneDriveFolderFiles,
} from '../onedrive/graphFolderUpload';
import { rejectOrionDocument } from './client';
import { ORION_LEGACY_FILE_ID } from './config';
import {
  MSG_ORION_NO_DETENIDO,
  puedeEliminarDocumento,
  validarJustificacionEliminacion,
} from './deletePolicy';
import { isMissingTableError, logOrionDocumentEvent } from './documentEvents';
import { getOrionDocumentFromBag } from './formValue';
import { insertRequestNote, loadOrionFormBag, upsertOrionFormBag } from './service';

type SqlPool = import('mssql').ConnectionPool;

/** Carpeta de adjuntos de la solicitud general (igual que list-attachments / attachment-file). */
function requestFolderSegments(requestId: number): string[] {
  return ['SAPSEND', 'TEC', 'SG', `Request-${requestId}`];
}

export type DeleteRequestDocumentResult = {
  fileId: string;
  oneDriveDeleted: boolean;
  /** Tareas de firma/autorización/validación cerradas (id_status 3), no borradas. */
  tasksClosed: number;
  indexDeleted: number;
  orionDocumentIds: string[];
  /** true si se detuvo el flujo en Orion; null si no había flujo activo que detener. */
  orionStopped: boolean | null;
};

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * Elimina un documento de la solicitud con estas reglas (ver deletePolicy.ts):
 *  - Doble llave: administrador Y permiso “Eliminar adjuntos” (403 si falta alguna).
 *  - FIRMADO / SIGNED / COMPLETED: no se elimina (409).
 *  - PENDIENTE_FIRMA / EN_PROCESO con documento en Orion: se rechaza primero en Orion;
 *    si Orion no lo confirma no se toca nada (502).
 *  - El fileId debe pertenecer a la carpeta de la solicitud en OneDrive (o al bag de firma).
 *  - Justificación obligatoria (400): queda en la nota del historial de la solicitud, en el
 *    evento ELIMINADO de la hoja de vida y en la resolución de las tareas cerradas.
 *
 * Lo que NO se borra: la hoja de vida (orion_document_event) — se agrega un evento ELIMINADO —
 * y las tareas (task_request_general), que se cierran con id_status 3 (Rechazado/Cancelado).
 * El índice orion_document_index sí se borra: es derivado del bag y solo sirve para listar;
 * dejar la fila apuntaría a un archivo que ya no existe. El rastro queda en la hoja de vida,
 * en bag.deletedDocuments (que evita que un webhook tardío lo reviva) y en la nota.
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
    esAdmin: boolean;
    tienePermisoEliminarAdjuntos: boolean;
    justification: string;
  }
): Promise<DeleteRequestDocumentResult> {
  const { requestId } = params;
  const fileId = String(params.fileId || '').trim();
  const actorLabel = params.actorEmail;
  const actorDisplay = params.actorName
    ? `${params.actorName} (${params.actorEmail})`
    : params.actorEmail;
  const justificacion = validarJustificacionEliminacion(params.justification);
  if (!justificacion.ok) throw httpError(justificacion.error, 400);
  const justification = justificacion.valor;

  const loaded = await loadOrionFormBag(pool, requestId);
  const inBag = Boolean(loaded?.bag.documents[fileId]);
  const state = loaded ? getOrionDocumentFromBag(loaded.bag, fileId) : {};
  const currentDocId = String(state.orionDocumentId || '').trim();
  const status = String(state.status || '').toUpperCase();

  const decision = puedeEliminarDocumento({
    status,
    esAdmin: params.esAdmin,
    tienePermisoEliminarAdjuntos: params.tienePermisoEliminarAdjuntos,
    tieneDocumentoOrion: Boolean(currentDocId),
  });
  if (!decision.permitido) {
    throw httpError(decision.motivo || 'No se puede eliminar el documento.', decision.httpStatus);
  }

  const orionDocumentIds = [
    ...new Set(
      [
        currentDocId,
        ...(state.supersededDocuments ?? []).map((d) => String(d.orionDocumentId || '').trim()),
      ].filter(Boolean)
    ),
  ];
  const fileName = params.fileName || state.fileName || fileId;

  // 1) El archivo debe ser de esta solicitud antes de tocar nada.
  let token: string | null = null;
  let deleteFromOneDrive = false;
  if (fileId !== ORION_LEGACY_FILE_ID) {
    token = await getMicrosoftToken();
    if (!token) throw httpError('No se pudo obtener token de OneDrive', 502);
    const folder = requestFolderSegments(requestId);
    const meta = await getOneDriveItemMeta(token, fileId);
    if (meta) {
      let inFolder = isOneDriveItemInFolder(meta, folder);
      if (!inFolder && !meta.parentName && !meta.parentPath) {
        const listed = await listOneDriveFolderFiles(token, folder);
        inFolder = listed.some((f) => f.id === fileId);
      }
      if (!inFolder) throw httpError('El documento no pertenece a esta solicitud.', 404);
    } else if (!inBag) {
      // Ni se pudo leer en OneDrive ni está en el estado de firma de la solicitud.
      throw httpError('Documento no encontrado en esta solicitud.', 404);
    }
    // Sin metadatos pero en el bag: el fileId es de esta solicitud; se intenta borrar
    // igual (404 es idempotente y un error transitorio aborta en vez de dejar huérfano).
    deleteFromOneDrive = true;
  } else if (!inBag) {
    throw httpError('Documento no encontrado en esta solicitud.', 404);
  }

  // 2) Flujo activo: detenerlo en Orion y exigir confirmación antes de borrar.
  let orionStopped: boolean | null = null;
  if (decision.requiereDetenerOrion) {
    let stopError: string | null = null;
    try {
      const res = await rejectOrionDocument(currentDocId, {
        email: params.actorEmail,
        reason: `Documento eliminado en SynerLink por ${actorLabel}`,
      });
      if (!res.ok) stopError = res.error || `HTTP ${res.status}`;
    } catch (err) {
      stopError = err instanceof Error ? err.message : 'Error de red';
    }
    if (stopError) {
      console.warn(`[orion/delete] No se pudo detener ${currentDocId} en Orion:`, stopError);
      throw httpError(MSG_ORION_NO_DETENIDO, 502);
    }
    orionStopped = true;
  } else if (currentDocId && status === 'BORRADOR') {
    // Borrador ya creado en Orion: se intenta rechazar para que no quede huérfano, sin bloquear.
    try {
      const res = await rejectOrionDocument(currentDocId, {
        email: params.actorEmail,
        reason: `Documento eliminado en SynerLink por ${actorLabel}`,
      });
      if (!res.ok) console.warn(`[orion/delete] borrador ${currentDocId} no rechazado:`, res.error);
    } catch (err) {
      console.warn(`[orion/delete] borrador ${currentDocId} no rechazado:`, err);
    }
  }

  // 3) Archivo en OneDrive.
  let oneDriveDeleted = false;
  if (token && deleteFromOneDrive) {
    await deleteOneDriveItem(token, fileId);
    oneDriveDeleted = true;
  }

  // 4) Tareas del documento: se cierran (3 = Rechazado/Cancelado), no se borran.
  const tasks = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('fileMarker', sql.NVarChar(500), `[orionFile:${fileId}]`)
    .input('reviewMarker', sql.NVarChar(500), `[orionReviewFile:${fileId}]`)
    .input(
      'closeNote',
      sql.NVarChar(sql.MAX),
      ` Documento eliminado por ${actorLabel}. Justificación: ${justification}`
    )
    .input('id_executor', sql.NVarChar(255), params.actorUserId)
    .query(`
      UPDATE task_request_general
      SET id_status = 3,
          end_date = GETDATE(),
          date_resolution = GETDATE(),
          id_executor_final = @id_executor,
          resolution = CONCAT(ISNULL(resolution, N''), @closeNote)
      WHERE id_request_general = @id_request
        AND id_status NOT IN (2, 3)
        AND (
          CHARINDEX(@fileMarker, ISNULL(resolution, N'')) > 0
          OR CHARINDEX(@reviewMarker, ISNULL(resolution, N'')) > 0
        )
    `);
  const tasksClosed = Number(tasks.rowsAffected?.[0] || 0);

  // 5) Hoja de vida: se conserva y se agrega el evento ELIMINADO (nunca lanza).
  await logOrionDocumentEvent(pool, {
    requestId,
    fileId,
    orionDocumentId: currentDocId || null,
    versionLabel: state.versionLabel ?? null,
    eventType: 'ELIMINADO',
    actorEmail: params.actorEmail,
    actorName: params.actorName ?? null,
    detail:
      `Documento eliminado por ${actorDisplay} (estado previo: ${status || 'sin flujo'}). ` +
      `Justificación: ${justification}`,
  });

  // 6) Índice derivado: se borra la fila (ver comentario de la función).
  let indexDeleted = 0;
  try {
    const res = await pool
      .request()
      .input('id_request', sql.Int, requestId)
      .input('file_id', sql.NVarChar(400), fileId)
      .query(`DELETE FROM orion_document_index WHERE id_request = @id_request AND file_id = @file_id`);
    indexDeleted = Number(res.rowsAffected?.[0] || 0);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }

  // 7) Estado de firma: fuera de documents, dentro de deletedDocuments.
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
      `🗑️ Documento eliminado: ${fileName} — por ${actorDisplay} — Justificación: ${justification}`,
      params.actorUserId
    );
  } catch (err) {
    console.warn('[orion/delete] nota de auditoría:', err);
  }

  return {
    fileId,
    oneDriveDeleted,
    tasksClosed,
    indexDeleted,
    orionDocumentIds,
    orionStopped,
  };
}
