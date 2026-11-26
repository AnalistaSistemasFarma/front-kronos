'use client';

import HelpdeskDashboardView from '../../../../../components/help-desk/dashboard/HelpdeskDashboardView';

/**
 * Dashboard Helpdesk (/process/help-desk/dashboard): help desk indicators built
 * from the Tickets module. Access is checked by /api/help-desk/dashboard
 * (subprocess with this URL); see lib/help-desk/dashboard.
 */
export default function HelpdeskDashboardPage() {
  return <HelpdeskDashboardView />;
}
