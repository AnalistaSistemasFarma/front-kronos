/** Marcadores en resolution de tareas/autorizaciones Orion (safe para client). */

export const ORION_AUTH_MARKER = '[orionAuth]';

export function buildOrionFileTaskMarker(fileId?: string | null): string {
  const fid = String(fileId || '').trim();
  return fid ? `[orionFile:${fid}]` : '';
}

export function parseOrionFileIdFromResolution(resolution?: string | null): string | null {
  const match = /\[orionFile:([^\]]+)\]/i.exec(String(resolution || ''));
  return match?.[1]?.trim() || null;
}

/** Alias usado por la UI de autorizaciones. */
export function parseOrionFileIdFromAuthResolution(
  resolution?: string | null
): string | null {
  return parseOrionFileIdFromResolution(resolution);
}

export function buildOrionAuthResolution(params: {
  fileId: string;
  fileName?: string | null;
  signerEmail: string;
}): string {
  const marker = buildOrionFileTaskMarker(params.fileId);
  const name = params.fileName ? `: ${params.fileName}` : '';
  return `${marker}${ORION_AUTH_MARKER} Autorizar firma${name} (${params.signerEmail})`.trim();
}

/** Nombre del PDF embebido en resolution (`Autorizar firma: archivo.pdf (email)`). */
export function parseOrionFileNameFromResolution(
  resolution?: string | null
): string | null {
  const match =
    /Autorizar firma:\s*(.+?)\s*\([^)]+@[^)]+\)\s*$/i.exec(
      String(resolution || '').trim()
    ) ||
    /Autorizar firma:\s*(.+?)(?:\s*\(|$)/i.exec(String(resolution || '').trim());
  const name = String(match?.[1] || '')
    .trim()
    .replace(/^\[orionAuth\]\s*/i, '');
  return name || null;
}

/**
 * Validación previa a firma. Marcador de archivo distinto a [orionFile:] para que
 * la lógica de firmantes (turnos, autorizaciones, cierre de tareas) no la toque.
 */
export const ORION_REVIEW_MARKER = '[orionReview]';

export function buildOrionReviewResolution(params: {
  fileId: string;
  fileName?: string | null;
  versionLabel?: string | null;
  step: number;
  totalSteps: number;
}): string {
  const name = params.fileName ? `: ${params.fileName}` : '';
  const version = params.versionLabel ? `${params.versionLabel} · ` : '';
  return `${ORION_REVIEW_MARKER}[orionReviewFile:${params.fileId}] Validar documento${name} (${version}paso ${params.step}/${params.totalSteps})`;
}

export function isOrionReviewResolution(resolution?: string | null): boolean {
  return String(resolution || '').includes(ORION_REVIEW_MARKER);
}

export function parseOrionReviewFileId(resolution?: string | null): string | null {
  const match = /\[orionReviewFile:([^\]]+)\]/i.exec(String(resolution || ''));
  return match?.[1]?.trim() || null;
}

export function parseOrionReviewFileName(resolution?: string | null): string | null {
  const match = /Validar documento:\s*(.+?)\s*\((?:v\d+\.\d+\s*·\s*)?paso\s+\d+\/\d+\)/i.exec(
    String(resolution || '')
  );
  return match?.[1]?.trim() || null;
}

export function isOrionSignerAuthResolution(resolution?: string | null): boolean {
  return String(resolution || '').includes(ORION_AUTH_MARKER);
}

/** Tarea/auth Orion: resolution con [orionFile:] o [orionAuth] (no implica tarea cerrada). */
export function isOrionWorkflowResolution(resolution?: string | null): boolean {
  const value = String(resolution || '');
  return value.includes(ORION_AUTH_MARKER) || /\[orionFile:/i.test(value);
}

/**
 * Clasifica autorización de FIRMA digital (Orion) vs autorización NORMAL (p. ej. TESORERIA).
 * Prioriza marcadores en resolution; luego tipo/tarea de plantilla.
 * NO usa el asunto de la solicitud (evita falsos positivos).
 * TESORERIA / tipos sin "firma" → false (tras autorizar no se redirige a la solicitud).
 */
export function isFirmaAuthorizationItem(params: {
  resolution?: string | null;
  typeAuthorization?: string | null;
  taskName?: string | null;
}): boolean {
  if (isOrionReviewResolution(params.resolution)) return false;
  if (isOrionSignerAuthResolution(params.resolution)) return true;
  if (parseOrionFileIdFromResolution(params.resolution)) return true;

  const type = String(params.typeAuthorization || '').trim();
  // Excluir tipos de negocio que no son flujo Orion (aunque el nombre contenga otra cosa).
  if (type && /^tesorer/i.test(type)) return false;
  if (type && /firma/i.test(type)) return true;

  const task = String(params.taskName || '').trim();
  if (task && (/autorizar\s+firma/i.test(task) || /firma\s+digital/i.test(task))) {
    return true;
  }

  return false;
}
