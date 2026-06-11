'use client';

import Link from 'next/link';
import { Button } from '@mantine/core';
import { IconChartBar } from '@tabler/icons-react';
import { DASHBOARD_TAB_URL } from '../../lib/dashboard/DashboardTabContext';
import { useDashboardAdminOptional } from '../../lib/dashboard/DashboardAdminContext';

type HelpDeskDashboardLinkButtonProps = {
  size?: 'sm' | 'md' | 'lg';
};

export function HelpDeskDashboardLinkButton({
  size = 'lg',
}: HelpDeskDashboardLinkButtonProps) {
  const dashboardAdmin = useDashboardAdminOptional();
  const showLink =
    Boolean(dashboardAdmin?.isDashboardAdmin) && !dashboardAdmin?.loadingDashboardAdmin;

  if (!showLink) return null;

  return (
    <Button
      component={Link}
      href={DASHBOARD_TAB_URL.tickets}
      variant='light'
      size={size}
      leftSection={<IconChartBar size={18} />}
    >
      Dashboard de tickets
    </Button>
  );
}
