import { otNotifier, type OtNotificacion, type OtNotifier } from '../../../../lib/bitacora-proceso/notificaciones';

/**
 * Avisa al inspector sin romper la acción: si falla la consulta de datos o el
 * envío, solo se registra el error (la bitácora ya quedó abierta o cerrada).
 */
export async function avisarInspector(build: () => Promise<OtNotificacion[]>, notifier: OtNotifier = otNotifier): Promise<void> {
  try {
    await notifier(await build());
  } catch (error) {
    console.error('[bitacora-proceso/aviso]', error);
  }
}
