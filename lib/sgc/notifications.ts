/**
 * Notificaciones del SGC (push + campana), con eventos PROPIOS del módulo.
 *
 * Reutiliza la utilidad compartida lib/notifications.js (permitida por el
 * plan: «Notificaciones push/correo — Reutiliza; eventos propios en
 * lib/sgc/notifications.ts»). Los textos siguen el patrón de SynerLink
 * («Actividad asignada · SynerLink») para que una tarea documental se
 * notifique igual que una tarea general.
 */

export interface SgcNotificationPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export interface SgcNotification {
  emails: string[];
  payload: SgcNotificationPayload;
}

export type SgcNotifier = (notifications: SgcNotification[]) => Promise<void>;

export const SGC_NOTIFICATION_TITLES = {
  tareaAsignada: 'Tarea documental asignada · SynerLink',
  autorizacionPendiente: 'Autorización pendiente en Documentos · SynerLink',
  devuelta: 'Documento devuelto a elaboración · SynerLink',
  cancelada: 'Solicitud documental cancelada · SynerLink',
  nota: 'Nueva nota en solicitud documental · SynerLink',
  avance: 'Solicitud documental avanzó · SynerLink',
  // Sprint 4
  lecturaAsignada: 'Lectura obligatoria de documento · SynerLink',
  lecturaRecordatorio: 'Recordatorio: lectura obligatoria pendiente · SynerLink',
  capacitacionPendiente: 'Capacitación documental pendiente · SynerLink',
  documentoVigente: 'Documento vigente · SynerLink',
  // Correcciones de Calidad (2026-10-03)
  revisionMenor: 'Revisión menor de Calidad en un documento · SynerLink',
  lecturaUmbral: 'Avance de lectura de un documento · SynerLink',
  lecturaNoEntendi: 'Una persona no entendió un documento · SynerLink',
  // Sprint 11: copias no controladas.
  copiaNoControlada: 'Solicitud de copia no controlada · SynerLink',
  copiaNoControladaDecidida: 'Su copia no controlada fue decidida · SynerLink',
} as const;

export function taskUrl(idTask: number): string {
  return `/process/sgc-documental/tareas/${idTask}`;
}

export function requestUrl(idRequest: number): string {
  return `/process/sgc-documental/solicitudes/${idRequest}`;
}

/** Quita vacíos y repetidos, y nunca se notifica a quien hizo la acción. */
export function recipients(emails: readonly (string | null | undefined)[], exclude?: string | null): string[] {
  const ex = exclude?.trim().toLowerCase();
  return [...new Set(emails.map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e && e !== ex))];
}

/** No hace nada (pruebas y rutas que no notifican). */
export const noopNotifier: SgcNotifier = async () => {};

/** Notificador real: guarda en la campana y envía push. Nunca rompe la acción. */
export const sgcNotifier: SgcNotifier = async (notifications) => {
  if (notifications.length === 0) return;
  try {
    const { createAndSendNotifications } = await import('../notifications.js');
    await Promise.all(
      notifications
        .filter((n) => n.emails.length > 0)
        .map((n) => createAndSendNotifications(n.emails, n.payload).catch((e: unknown) => console.error('[sgc/notificaciones]', e)))
    );
  } catch (error) {
    console.error('[sgc/notificaciones]', error);
  }
};
