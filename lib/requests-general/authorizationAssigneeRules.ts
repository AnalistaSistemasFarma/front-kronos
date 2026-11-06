/**
 * Reglas de enrutamiento: cuando una tarea de autorización se crea sin responsable
 * en plantilla (id_assigned NULL), se asigna a un autorizador fijo según el
 * solicitante y el proceso. Así salen de la bandeja compartida (p. ej. Jeyson)
 * y llegan solo al destinatario.
 *
 * Claves = email del solicitante (minúsculas). Valores = email del autorizador.
 */
export const AUTHORIZATION_ASSIGNEE_BY_REQUESTER_EMAIL: Readonly<Record<string, string>> = {
  'dayana.vargas@gsslatam.com': 'jorge.alba@gsslatam.com',
};

/** Solo estos nombres de proceso (process_category.process) aplican la regla. */
export const AUTHORIZATION_ASSIGNEE_PROCESS_NAMES: ReadonlySet<string> = new Set([
  'Solicitud de Pago',
]);

export function resolveAuthorizationAssigneeEmail(
  requesterEmail: string | null | undefined,
  processName: string | null | undefined
): string | null {
  const requester = String(requesterEmail ?? '').trim().toLowerCase();
  const process = String(processName ?? '').trim();
  if (!requester || !process) return null;
  if (!AUTHORIZATION_ASSIGNEE_PROCESS_NAMES.has(process)) return null;
  return AUTHORIZATION_ASSIGNEE_BY_REQUESTER_EMAIL[requester] ?? null;
}
