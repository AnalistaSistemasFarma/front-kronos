/**
 * Tipo de una notificación de la campana (2026-11-11): las de firma y las de validación llevan
 * distintivo propio (ícono, color y etiqueta). Las notificaciones no guardan un tipo en la base,
 * así que se deduce del título y del enlace, como ya se hacía con tickets y actividades.
 * Orden: validación antes que firma («Aprobado para firma» es un resultado de la validación).
 */
export type NotificationKind = 'validacion' | 'firma' | 'ticket' | 'actividad' | 'general';

export interface NotificationKindInfo {
  kind: NotificationKind;
  /** Etiqueta corta junto a la hora (null = sin etiqueta). */
  label: string | null;
  /** Color de Mantine del ícono (los de estado no se usan aquí: esto es categoría, no estado). */
  color: string;
}

const VALIDACION = [
  'validar',
  'validado',
  'validación',
  'validacion',
  'validador',
  'aprobado para firma',
  'devuelto para corrección',
  'devuelto para correccion',
  'le toca corregir',
  'pedir corrección',
  'la marca',
  'le hizo una',
  'borrador',
  'el cliente rechazó',
  'aprobado por el cliente',
  'siguiente aprobador',
  'visto bueno',
];

const FIRMA = ['firma', 'firmar', 'firmante', 'firmado'];

export function notificationKind(title: string | null | undefined, path: string | null | undefined): NotificationKindInfo {
  const text = `${title ?? ''}`.toLowerCase();
  const link = `${path ?? ''}`.toLowerCase();
  if (VALIDACION.some((k) => text.includes(k)) || link.includes('draft-board')) {
    return { kind: 'validacion', label: 'Validación', color: 'teal' };
  }
  // Flujo de firma: por el título, o por el enlace al documento de firma (rechazado / devuelto).
  if (FIRMA.some((k) => text.includes(k)) || link.includes('orionfileid')) {
    return { kind: 'firma', label: 'Firma', color: 'violet' };
  }
  if (text.includes('ticket') || link.includes('view-ticket') || text.includes('mesa de ayuda')) {
    return { kind: 'ticket', label: null, color: 'blue' };
  }
  if (text.includes('actividad') || link.includes('view-activities')) {
    return { kind: 'actividad', label: null, color: 'blue' };
  }
  return { kind: 'general', label: null, color: 'blue' };
}
