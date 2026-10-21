import { isPermisosAgentesMarkerSubprocess } from '../proyectos/permisos-agentes-rules';
import {
  isOrionFirmaPrepareSubprocess,
  isOrionFirmaSignSubprocess,
} from '../orion/access';
import { isDeleteAttachmentsSubprocess } from '../attachments/access';
import { isValentineWallSubprocess } from '../valentine/constants';
import { isSgcPermissionMarkerSubprocess } from '../sgc/constants';
import { isOtPermissionMarkerSubprocess } from '../bitacora-proceso/constants';
import {
  isAuditConfigureMarkerSubprocess,
  isAuditConversationsMarkerSubprocess,
} from '../chat/audit-constants';
import { isLoginAuditMarkerSubprocess } from '../auth/login-audit/constants';
import { isProjectsConfigMarkerSubprocess } from '../proyectos/config-agentes-rules';

export const DASHBOARD_SOLICITANTE_URL = '/process/request-general/dashboard-solicitante';
export const DASHBOARD_SOLICITADO_URL = '/process/request-general/dashboard-solicitado';

/**
 * Subprocesos que viven en el header o son solo permiso (no listar en el hub).
 * Función pura — segura para componentes cliente.
 */
export function isHubHiddenRequestDashboardSubprocess(subprocess: {
  subprocess?: string | null;
  subprocess_url?: string | null;
}): boolean {
  if (
    // Permisos de los agentes en Proyectos (2026-10-20): marcador, no página.
    isPermisosAgentesMarkerSubprocess(subprocess) ||
    isOrionFirmaPrepareSubprocess(subprocess) ||
    isOrionFirmaSignSubprocess(subprocess) ||
    isDeleteAttachmentsSubprocess(subprocess) ||
    isValentineWallSubprocess(subprocess) ||
    isSgcPermissionMarkerSubprocess(subprocess) ||
    isOtPermissionMarkerSubprocess(subprocess) ||
    isAuditConversationsMarkerSubprocess(subprocess) ||
    isAuditConfigureMarkerSubprocess(subprocess) ||
    isLoginAuditMarkerSubprocess(subprocess) ||
    isProjectsConfigMarkerSubprocess(subprocess)
  ) {
    return true;
  }

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
