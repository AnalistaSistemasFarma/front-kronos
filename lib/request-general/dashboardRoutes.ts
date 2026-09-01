export const DASHBOARD_SOLICITANTE_URL = '/process/request-general/dashboard-solicitante';
export const DASHBOARD_SOLICITADO_URL = '/process/request-general/dashboard-solicitado';

/**
 * Subprocesos que viven en el header (no deben listarse en el hub de Procesos).
 * Función pura — segura para componentes cliente.
 */
export function isHubHiddenRequestDashboardSubprocess(subprocess: {
  subprocess?: string | null;
  subprocess_url?: string | null;
}): boolean {
  const url = (subprocess.subprocess_url ?? '').toLowerCase().trim();
  if (
    url === DASHBOARD_SOLICITADO_URL.toLowerCase() ||
    url === DASHBOARD_SOLICITANTE_URL.toLowerCase() ||
    url.includes('/dashboard-solicitado') ||
    url.includes('/dashboard-solicitante')
  ) {
    return true;
  }

  const name = (subprocess.subprocess ?? '').toLowerCase().trim();
  return (
    name === 'dashboard solicitado' ||
    name.includes('dashboard solicitado') ||
    name === 'dashboard personal' ||
    name.includes('dashboard personal') ||
    name === 'dashboard solicitante' ||
    name.includes('dashboard solicitante') ||
    name === 'dashboard solicitudes' ||
    name.includes('dashboard solicitudes')
  );
}
