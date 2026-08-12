'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAppSection } from '../../lib/navigation/AppSectionContext';
import { isHubInstantSwapRoute } from '../../lib/navigation/AppSectionContext';
import { useDashboardAdmin } from '../../lib/dashboard/DashboardAdminContext';
import DashboardShell from '../dashboard/DashboardShell';
import ProcessView from '../process/ProcessView';
import ProcessAiContextBridge from '../process/ProcessAiContextBridge';

function HubPanels() {
  const { activeSection } = useAppSection();
  const { isDashboardAdmin, loadingDashboardAdmin } = useDashboardAdmin();

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }, [activeSection]);

  const panelClass = (active: boolean) =>
    active ? 'hub-section hub-section--active' : 'hub-section';

  // Solo montar el shell admin cuando la sección activa es dashboard.
  // Así /process no dispara view-tasks/cases (evita 403 a usuarios sin permiso
  // y también el prefetch oculto).
  const showDashboard =
    !loadingDashboardAdmin && isDashboardAdmin && activeSection === 'dashboard';
  const showProcess = activeSection === 'process' || !showDashboard;

  return (
    <div className='hub-sections'>
      {showDashboard ? (
        <div
          className={panelClass(activeSection === 'dashboard')}
          aria-hidden={activeSection !== 'dashboard'}
        >
          <DashboardShell />
        </div>
      ) : null}
      <div className={panelClass(showProcess)} aria-hidden={!showProcess}>
        <ProcessAiContextBridge />
        <ProcessView />
      </div>
    </div>
  );
}

export default function AppHubShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const instantSwap = isHubInstantSwapRoute(pathname);

  if (!instantSwap) {
    return <main className='app-page-shell'>{children}</main>;
  }

  return (
    <main className='app-page-shell'>
      <HubPanels />
    </main>
  );
}
