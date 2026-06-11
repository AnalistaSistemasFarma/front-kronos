/** Normaliza estados de vw_tareas_solicitudes al modelo del dashboard. */
export function normalizeActivityStatus(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return 'Pendiente';

  const lower = value.toLowerCase();
  if (lower === 'completada' || lower === 'resuelto' || lower === 'resuelta') {
    return 'Completada';
  }
  if (lower === 'en proceso' || lower === 'en progreso') {
    return 'En Proceso';
  }
  if (
    lower === 'pendiente' ||
    lower === 'sin empezar' ||
    lower === 'abierto' ||
    lower === 'sin empezar '
  ) {
    return 'Pendiente';
  }

  return value;
}

export function normalizeAssigneeName(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  return trimmed || 'Sin asignar';
}
