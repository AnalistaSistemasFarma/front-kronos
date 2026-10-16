/**
 * Formato de fechas de las Tareas documentales: el MISMO formato visible de
 * SynerLink («30 de septiembre de 2026, 03:07 p. m.»). A diferencia de las
 * solicitudes generales —cuyas fechas se guardan en hora de Colombia y se
 * corrigen sumando 5 horas—, las del SGC se guardan en UTC real y se muestran
 * en la zona horaria de Bogotá.
 */
export function formatDateCO(value?: string | null, options?: { month?: 'long' | 'short'; fallback?: string }): string {
  const fallback = options?.fallback ?? '—';
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: options?.month ?? 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Bogota',
  }).format(parsed);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
