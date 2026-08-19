/**
 * Flujo de AUTORIZACIÓN de las corridas de pago del Asistente de Pagos.
 *
 * Una "corrida de pago" reutiliza el MOTOR de Autorizaciones existente: al enviarla se crea una
 * solicitud (`requests_general`) con una TAREA de autorización (`task_request_general`, estado 4 =
 * pendiente, `id_assigned` NULL) cuya plantilla (`task_process_category`) tiene `is_authorization=1`
 * y un `type_authorization`. El enrutamiento del aprobador lo resuelve el mecanismo ya existente
 * (usuarios con ese `type_authorization` ∩ misma empresa ∩ mismo departamento que el solicitante),
 * de modo que la autorización aparece sola en `/process/authorization`.
 *
 * La generación del archivo DISFON queda BLOQUEADA hasta que esa tarea de autorización esté
 * APROBADA (id_status = 2).
 *
 * NOTA de segregación de funciones: en PRUEBAS el aprobador configurado es Nicolás (el mismo que
 * puede crear la corrida). En PRODUCCIÓN el aprobador debe ser DISTINTO de quien la crea y el
 * enrutamiento va por el departamento de Tesorería (no se hardcodea aquí: lo define la asignación
 * de `type_authorization` a los usuarios de ese departamento).
 */

/** Nombre del proceso ( `process_category.process` ) que agrupa la tarea de autorización. */
export const PAYMENT_RUN_PROCESS_NAME = 'Corrida de Pago';

/** Estado de una corrida de pago según la tarea de autorización que la respalda. */
export type PaymentRunStatus = 'pendiente' | 'aprobada' | 'rechazada';

/**
 * Traduce el `id_status` de la tarea de autorización al estado de la corrida:
 *   2 (Resuelto/Aprobado) -> 'aprobada'
 *   3 (Cancelado/Rechazado) -> 'rechazada'
 *   4 u otro/NULL -> 'pendiente'
 */
export function mapAuthStatusToRunStatus(
  idStatus: number | null | undefined
): PaymentRunStatus {
  if (idStatus === 2) return 'aprobada';
  if (idStatus === 3) return 'rechazada';
  return 'pendiente';
}

/** true solo si la corrida está APROBADA (única condición que habilita generar el DISFON). */
export function isPaymentRunApproved(idStatus: number | null | undefined): boolean {
  return idStatus === 2;
}
