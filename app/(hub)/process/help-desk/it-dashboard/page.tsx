'use client';

import ItDashboardView from '../../../../../components/it-dashboard/ItDashboardView';

/**
 * Dashboard TI (/process/help-desk/it-dashboard): IT asset inventory board
 * built from the Activos module. Access is checked by /api/it-dashboard
 * (subprocess with this URL); see lib/it-dashboard.
 */
export default function ItDashboardPage() {
  return <ItDashboardView />;
}
