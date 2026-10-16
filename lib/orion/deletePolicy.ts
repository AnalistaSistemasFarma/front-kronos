/**
 * Regla de negocio para eliminar un documento (adjunto) de una solicitud.
 * Módulo puro: lo usan el servidor (delete-attachment) y la UI (ocultar el botón).
 *
 * Doble llave (decisión de Nicolás Rivera, 2026-09-29): hay que ser administrador
 * (checkAdminPrivileges: rol admin/super_user o subproceso /process/administration/users)
 * Y tener el subproceso “Eliminar adjuntos” (/process/request-general/delete-attachments).
 */

/** Estados finales: el documento ya quedó firmado y no se puede eliminar. */
export const ORION_FINAL_STATUSES = new Set(['FIRMADO', 'SIGNED', 'COMPLETED']);

/** Flujo vivo en Orion: hay que detenerlo (rechazo) antes de eliminar. */
export const ORION_ACTIVE_FLOW_STATUSES = new Set(['PENDIENTE_FIRMA', 'EN_PROCESO']);

export const MSG_DOCUMENTO_FIRMADO = 'El documento ya fue firmado y no se puede eliminar.';
export const MSG_ORION_NO_DETENIDO =
  'No se pudo detener el flujo de firma en Orion; intente de nuevo.';

export type DecisionEliminarDocumento = {
  permitido: boolean;
  /** Mensaje en español cuando no se permite (null si se permite). */
  motivo: string | null;
  /** Código HTTP a devolver si no se permite (200 si se permite). */
  httpStatus: number;
  /** true si antes de borrar hay que detener el flujo en Orion y exigir su confirmación. */
  requiereDetenerOrion: boolean;
};

export function esEstadoFinalOrion(status?: string | null): boolean {
  return ORION_FINAL_STATUSES.has(String(status || '').trim().toUpperCase());
}

/** Falta alguna de las dos llaves → mensaje que dice exactamente qué falta. */
export function motivoFaltaPermisoEliminar(
  esAdmin: boolean,
  tienePermisoEliminarAdjuntos: boolean
): string | null {
  if (esAdmin && tienePermisoEliminarAdjuntos) return null;
  if (!esAdmin && !tienePermisoEliminarAdjuntos) {
    return 'Para eliminar documentos debe ser administrador y tener el permiso “Eliminar adjuntos” (Administración → Usuarios).';
  }
  if (!esAdmin) {
    return 'Solo los administradores pueden eliminar documentos de la solicitud.';
  }
  return 'Le falta el permiso “Eliminar adjuntos”. Solicítelo en Administración → Usuarios.';
}

export function puedeEliminarDocumento(params: {
  status?: string | null;
  esAdmin: boolean;
  tienePermisoEliminarAdjuntos: boolean;
  /** Hay un documento creado en Orion (orionDocumentId). */
  tieneDocumentoOrion?: boolean;
}): DecisionEliminarDocumento {
  const faltaPermiso = motivoFaltaPermisoEliminar(
    params.esAdmin,
    params.tienePermisoEliminarAdjuntos
  );
  if (faltaPermiso) {
    return { permitido: false, motivo: faltaPermiso, httpStatus: 403, requiereDetenerOrion: false };
  }

  const status = String(params.status || '').trim().toUpperCase();
  if (ORION_FINAL_STATUSES.has(status)) {
    return {
      permitido: false,
      motivo: MSG_DOCUMENTO_FIRMADO,
      httpStatus: 409,
      requiereDetenerOrion: false,
    };
  }

  return {
    permitido: true,
    motivo: null,
    httpStatus: 200,
    // Sin documento en Orion no hay nada que detener allá (p. ej. envío fallido).
    requiereDetenerOrion: ORION_ACTIVE_FLOW_STATUSES.has(status) && Boolean(params.tieneDocumentoOrion),
  };
}

export const JUSTIFICACION_MIN = 10;
export const JUSTIFICACION_MAX = 1000;

export type ValidacionJustificacion =
  | { ok: true; valor: string; error: null }
  | { ok: false; valor: string; error: string };

/** Justificación obligatoria para eliminar (se valida igual en la UI y en el servidor). */
export function validarJustificacionEliminacion(value: unknown): ValidacionJustificacion {
  const valor = typeof value === 'string' ? value.trim() : '';
  if (!valor) {
    return { ok: false, valor, error: 'La justificación es obligatoria para eliminar el documento.' };
  }
  if (valor.length < JUSTIFICACION_MIN) {
    return {
      ok: false,
      valor,
      error: `La justificación debe tener al menos ${JUSTIFICACION_MIN} caracteres.`,
    };
  }
  if (valor.length > JUSTIFICACION_MAX) {
    return {
      ok: false,
      valor,
      error: `La justificación no puede superar ${JUSTIFICACION_MAX} caracteres.`,
    };
  }
  return { ok: true, valor, error: null };
}
