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

export function isOrionSignerAuthResolution(resolution?: string | null): boolean {
  return String(resolution || '').includes(ORION_AUTH_MARKER);
}

/** Tarea/auth Orion: resolution con [orionFile:] o [orionAuth] (no implica tarea cerrada). */
export function isOrionWorkflowResolution(resolution?: string | null): boolean {
  const value = String(resolution || '');
  return value.includes(ORION_AUTH_MARKER) || /\[orionFile:/i.test(value);
}
