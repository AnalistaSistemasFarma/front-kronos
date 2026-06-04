'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAppSection } from '../../lib/navigation/AppSectionContext';
import { isHubInstantSwapRoute } from '../../lib/navigation/AppSectionContext';
import DashboardShell from '../dashboard/DashboardShell';
import ProcessView from '../process/ProcessView';

function HubPanels() {
  const { activeSection } = useAppSection();

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }, [activeSection]);

  const panelClass = (active: boolean) =>
    active ? 'hub-section hub-section--active' : 'hub-section';

  return (
    <div className='hub-sections'>
      <div
        className={panelClass(activeSection === 'dashboard')}
        aria-hidden={activeSection !== 'dashboard'}
      >
        <DashboardShell />
      </div>
      <div
        className={panelClass(activeSection === 'process')}
        aria-hidden={activeSection !== 'process'}
      >
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
