/**
 * Dashboard Helpdesk (/process/help-desk/dashboard).
 *
 * Access is granted ONLY through the subprocess with this URL (Administración →
 * Usuarios). A global admin role is NOT enough: the module is meant for the
 * people who are explicitly assigned to it.
 */
export const HELPDESK_DASHBOARD_URL = '/process/help-desk/dashboard';

/** status_case ids (KRONOSDB): 2 = Resuelto, 3 = Cancelado. Every other status counts as pending. */
export const CASE_STATUS_RESOLVED = 2;
export const CASE_STATUS_CANCELLED = 3;
