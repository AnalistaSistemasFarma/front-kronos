// Las columnas DATETIME de SQL Server guardan la hora local de Colombia sin zona, y
// mssql las entrega como si fueran UTC; formatear en 'UTC' muestra la hora tal como
// quedó guardada sin depender de la zona horaria del navegador.
export function formatDbDateTime(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
  fallback = '—'
): string {
  if (value == null || value === '') return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('es-CO', { ...options, timeZone: 'UTC' }).format(date);
}
