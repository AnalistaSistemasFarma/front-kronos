/**
 * Constantes PURAS de la Auditoría de agentes (sin Prisma), seguras para
 * componentes cliente. La reja con base de datos está en lib/chat/audit-access.ts.
 */

/**
 * Subproceso-permiso APARTE para leer el TEXTO de las conversaciones en la
 * Auditoría de agentes (decisión de Nicolás, 2026-10-02). Es un marcador, no
 * una página: no se lista en el hub (lib/request-general/dashboardRoutes.ts).
 */
export const AUDIT_CONVERSATIONS_URL = '/process/chat/auditoria/conversaciones';

/** ¿Es el marcador del permiso de conversaciones? (para ocultarlo del hub). */
export function isAuditConversationsMarkerSubprocess(subprocess: {
  subprocess_url?: string | null;
}): boolean {
  return (subprocess.subprocess_url ?? '').toLowerCase().trim() === AUDIT_CONVERSATIONS_URL;
}

/**
 * Subproceso-permiso para CONFIGURAR la hoja de vida de los agentes (F2):
 * editar el propósito y el dueño. Ver solo la hoja de vida no lo necesita
 * (basta el permiso del módulo). Es un marcador, no una página: no se lista en
 * el hub. Sin segunda puerta para administradores: se otorga con nombre propio.
 */
export const AUDIT_CONFIGURE_URL = '/process/chat/auditoria/configurar';

/** ¿Es el marcador del permiso de configurar? (para ocultarlo del hub). */
export function isAuditConfigureMarkerSubprocess(subprocess: {
  subprocess_url?: string | null;
}): boolean {
  return (subprocess.subprocess_url ?? '').toLowerCase().trim() === AUDIT_CONFIGURE_URL;
}
