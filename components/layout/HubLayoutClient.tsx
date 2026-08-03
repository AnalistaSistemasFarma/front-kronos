'use client';

import Header from '../Header';
import AppHubShell from './AppHubShell';
import { AppSectionProvider } from '../../lib/navigation/AppSectionContext';
import { DashboardAdminProvider } from '../../lib/dashboard/DashboardAdminContext';
import { ProcessDataProvider } from '../../lib/process/ProcessDataContext';
import { RequestRoleNavProvider } from '../../lib/request-general/SolicitadoNavContext';

export default function HubLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <DashboardAdminProvider>
      <RequestRoleNavProvider>
        <AppSectionProvider>
          <ProcessDataProvider>
            <Header />
            <AppHubShell>{children}</AppHubShell>
          </ProcessDataProvider>
        </AppSectionProvider>
      </RequestRoleNavProvider>
    </DashboardAdminProvider>
  );
}
