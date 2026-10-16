/**
 * Colores del Monitor del sistema.
 *
 * - Series: paleta categórica validada para daltonismo (orden fijo). El color sigue a la
 *   ENTIDAD, nunca a su posición: cada módulo tiene su color asignado y lo conserva aunque
 *   cambie el ranking o el rango de tiempo.
 * - Estado: colores del sistema estilo Apple (verde/naranja/rojo), siempre acompañados de
 *   ícono y texto; nunca se reutilizan como color de serie.
 */

const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export function seriesColor(index: number, isDark: boolean): string {
  const palette = isDark ? SERIES_DARK : SERIES_LIGHT;
  return palette[index % palette.length];
}

/** Módulo (etiqueta legible) → índice de color fijo. Los demás van a "Otros". */
const MODULE_SLOTS: Record<string, number> = {
  'Solicitudes generales': 0,
  'Firma electrónica (Orion)': 1,
  'Chat / Asistentes IA': 2,
  'SGC documental': 3,
  'Help desk': 4,
  'Archivos estáticos': 5,
  Dashboard: 6,
  Notificaciones: 7,
};

export const OTHER_MODULES = 'Otros módulos';

export function moduleSlot(label: string): number | null {
  return label in MODULE_SLOTS ? MODULE_SLOTS[label] : null;
}

export function moduleColor(label: string, isDark: boolean): string {
  const slot = moduleSlot(label);
  if (slot == null) return isDark ? '#8e8e93' : '#aeaeb2';
  return seriesColor(slot, isDark);
}

export type StatusTone = 'ok' | 'warning' | 'critical' | 'info' | 'idle';

export const STATUS_LABEL: Record<StatusTone, string> = {
  ok: 'Normal',
  warning: 'Atención',
  critical: 'Crítico',
  info: 'Información',
  idle: 'Sin datos',
};

/** Color estable por persona (no cambia aunque cambie su puesto en el ranking). */
export function avatarColor(email: string, isDark: boolean): string {
  let hash = 0;
  for (let i = 0; i < email.length; i += 1) hash = (hash * 31 + email.charCodeAt(i)) | 0;
  return seriesColor(Math.abs(hash), isDark);
}
