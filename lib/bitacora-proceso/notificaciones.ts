import { OT_BASE_URL } from './constants';

/**
 * Notificaciones de la Bitácora de Proceso (campana + push web), con eventos
 * PROPIOS del módulo sobre el notificador compartido de SynerLink
 * (lib/notifications.js → createAndSendNotifications: fila en `notifications`
 * para la campana y push web a las suscripciones de la persona, si las hay).
 * Mismo patrón que lib/sgc/notifications.ts. NO envía correos.
 *
 * Eventos (Nicolás, 2026-10-14: «el que debe verificar no le llegó como
 * notificación push»):
 *   - Al ABRIR: aviso al inspector designado.
 *   - Al CERRAR firmado («Cerró»): aviso al inspector para que verifique, con
 *     enlace directo a la bitácora.
 * Nunca se notifica a quien hizo la acción y nunca rompe la acción.
 */

export interface OtNotificacion {
  emails: string[];
  payload: { title: string; body: string; url: string; tag?: string };
}

export type OtNotifier = (n: OtNotificacion[]) => Promise<void>;

export const OT_NOTIF_TITULOS = {
  inspectorAsignado: 'Fue designado inspector de una bitácora · SynerLink',
  porVerificar: 'Bitácora por verificar · SynerLink',
} as const;

/** Enlace directo a la bitácora (la pantalla toma la empresa de ?empresa=). */
export function bitacoraUrl(idOrden: number, idCompany: number): string {
  return `${OT_BASE_URL}/${idOrden}?empresa=${idCompany}`;
}

export interface AvisoInspector {
  idOrden: number;
  idCompany: number;
  consecutivo: number;
  producto: string;
  lote: string;
  inspectorEmail: string | null;
  /** Nombre de quien hizo la acción (abrió o cerró). */
  actorNombre: string;
  actorEmail: string;
}

function destinatarios(a: AvisoInspector): string[] {
  const to = a.inspectorEmail?.trim().toLowerCase();
  return to && to !== a.actorEmail.trim().toLowerCase() ? [to] : [];
}

function referencia(a: AvisoInspector): string {
  return `la bitácora N.º ${a.consecutivo} (${a.producto}, lote ${a.lote})`;
}

export function avisoInspectorAsignado(a: AvisoInspector): OtNotificacion[] {
  const emails = destinatarios(a);
  if (emails.length === 0) return [];
  return [
    {
      emails,
      payload: {
        title: OT_NOTIF_TITULOS.inspectorAsignado,
        body: `${a.actorNombre} abrió ${referencia(a)} y lo designó inspector. Al cierre del supervisor le corresponde verificarla y firmar «Verificó».`,
        url: bitacoraUrl(a.idOrden, a.idCompany),
        tag: `ot-${a.idOrden}-inspector`,
      },
    },
  ];
}

export function avisoPorVerificar(a: AvisoInspector): OtNotificacion[] {
  const emails = destinatarios(a);
  if (emails.length === 0) return [];
  return [
    {
      emails,
      payload: {
        title: OT_NOTIF_TITULOS.porVerificar,
        body: `${a.actorNombre} cerró y firmó ${referencia(a)}. Ábrala para verificarla y firmar «Verificó».`,
        url: bitacoraUrl(a.idOrden, a.idCompany),
        tag: `ot-${a.idOrden}-verificar`,
      },
    },
  ];
}

/** Notificador real (campana + push). Nunca lanza: un fallo de notificación no deshace la acción. */
export const otNotifier: OtNotifier = async (notificaciones) => {
  const list = notificaciones.filter((n) => n.emails.length > 0);
  if (list.length === 0) return;
  try {
    const { createAndSendNotifications } = await import('../notifications.js');
    await Promise.all(list.map((n) => createAndSendNotifications(n.emails, n.payload).catch((e: unknown) => console.error('[bitacora-proceso/notificaciones]', e))));
  } catch (error) {
    console.error('[bitacora-proceso/notificaciones]', error);
  }
};
