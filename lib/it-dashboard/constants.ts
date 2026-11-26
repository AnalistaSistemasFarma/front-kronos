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

/**
 * Companies left out of the board (panel, totals and lists), compared by
 * trimmed upper-case name. Requested by Cristian Baldion on 2026-11-26.
 */
export const EXCLUDED_COMPANY_NAMES = ['UNIDOSSIS', 'ONELATAMONCO', 'PRUEBAS'] as const;

/** True when the company name is one of EXCLUDED_COMPANY_NAMES. */
export function isExcludedCompany(name: string | null | undefined): boolean {
  const key = (name ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  return (EXCLUDED_COMPANY_NAMES as readonly string[]).includes(key);
}

/** Max rows returned by the drill-down list. */
export const IT_DASHBOARD_LIST_LIMIT = 2000;
