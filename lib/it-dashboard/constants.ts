/**
 * Dashboard TI (/process/help-desk/it-dashboard): IT asset inventory board
 * built from the Activos module (assets, type_asset, company...).
 *
 * Access is granted ONLY through the subprocess with this URL (Administración →
 * Usuarios). A global admin role is NOT enough.
 */
export const IT_DASHBOARD_URL = '/process/help-desk/it-dashboard';

/** Id used for assets without company or without asset type. */
export const UNASSIGNED_ID = 0;

/** Max rows returned by the drill-down list. */
export const IT_DASHBOARD_LIST_LIMIT = 2000;
