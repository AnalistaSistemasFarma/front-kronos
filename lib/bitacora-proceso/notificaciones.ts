import { OT_BASE_URL, OT_ROL_LABEL, type OtFirmaRol } from './constants';

/**
 * Notificaciones de la Bitácora de Proceso (campana + push web), con eventos
 * PROPIOS del módulo sobre el notificador compartido de SynerLink
 * (lib/notifications.js → createAndSendNotifications: fila en `notifications`
 * para la campana y push web a las suscripciones de la persona, si las hay).
 * Mismo patrón que lib/sgc/notifications.ts. NO envía correos.
 *
 * Eventos (B1/B2, 2026-10-15: cuatro actores):
 *   - Al ABRIR: aviso de designación al INSPECTOR y al JEFE DE PRODUCCIÓN.
 *   - Tras cada visto bueno: aviso a quien le toca el SIGUIENTE (después del cierre del
 *     supervisor, al inspector; después del inspector, al jefe de producción), con
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
  jefeAsignado: 'Fue designado jefe de producción de una bitácora · SynerLink',
  porVistoBueno: 'Bitácora pendiente de su visto bueno · SynerLink',
} as const;

/** Enlace directo a la bitácora (la pantalla toma la empresa de ?empresa=). */
export function bitacoraUrl(idOrden: number, idCompany: number): string {
  return `${OT_BASE_URL}/${idOrden}?empresa=${idCompany}`;
}

export interface AvisoBitacora {
  idOrden: number;
  idCompany: number;
  consecutivo: number;
  producto: string;
  lote: string;
  inspectorEmail: string | null;
  jefeEmail: string | null;
  /** Nombre de quien hizo la acción (abrió o dio el visto bueno). */
  actorNombre: string;
  actorEmail: string;
}

function destinatario(email: string | null, a: AvisoBitacora): string[] {
  const to = email?.trim().toLowerCase();
  return to && to !== a.actorEmail.trim().toLowerCase() ? [to] : [];
}

function referencia(a: AvisoBitacora): string {
  return `la bitácora N.º ${a.consecutivo} (${a.producto}, lote ${a.lote})`;
}

/** Al abrir: avisos de designación al inspector y al jefe de producción. */
export function avisosApertura(a: AvisoBitacora): OtNotificacion[] {
  const out: OtNotificacion[] = [];
  const url = bitacoraUrl(a.idOrden, a.idCompany);
  const insp = destinatario(a.inspectorEmail, a);
  if (insp.length) {
    out.push({
      emails: insp,
      payload: {
        title: OT_NOTIF_TITULOS.inspectorAsignado,
        body: `${a.actorNombre} abrió ${referencia(a)} y lo designó inspector. Después del cierre del supervisor le corresponde su visto bueno.`,
        url,
        tag: `ot-${a.idOrden}-inspector`,
      },
    });
  }
  const jefe = destinatario(a.jefeEmail, a);
  if (jefe.length) {
    out.push({
      emails: jefe,
      payload: {
        title: OT_NOTIF_TITULOS.jefeAsignado,
        body: `${a.actorNombre} abrió ${referencia(a)} y lo designó jefe de producción. Su visto bueno es el último, después del inspector.`,
        url,
        tag: `ot-${a.idOrden}-jefe`,
      },
    });
  }
  return out;
}

/** Tras un visto bueno: aviso a quien le toca el siguiente (inspector o jefe de producción). */
export function avisoSiguienteVistoBueno(a: AvisoBitacora, dado: OtFirmaRol, siguiente: OtFirmaRol | null): OtNotificacion[] {
  if (siguiente !== 'INSPECTOR' && siguiente !== 'JEFE_PROD') return [];
  const emails = destinatario(siguiente === 'INSPECTOR' ? a.inspectorEmail : a.jefeEmail, a);
  if (emails.length === 0) return [];
  const accion = dado === 'SUPERVISOR' ? `cerró ${referencia(a)} («Cerró»)` : `dio su visto bueno como ${OT_ROL_LABEL[dado].toLowerCase()} en ${referencia(a)}`;
  return [
    {
      emails,
      payload: {
        title: OT_NOTIF_TITULOS.porVistoBueno,
        body: `${a.actorNombre} ${accion}. Ábrala para dar su visto bueno como ${OT_ROL_LABEL[siguiente].toLowerCase()}.`,
        url: bitacoraUrl(a.idOrden, a.idCompany),
        tag: `ot-${a.idOrden}-${siguiente.toLowerCase()}`,
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
