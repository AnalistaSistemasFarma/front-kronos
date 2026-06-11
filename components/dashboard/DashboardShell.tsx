'use client';

import { memo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardDataProvider } from '../../lib/dashboard/DashboardDataContext';
import { DashboardTabProvider, useDashboardTab } from '../../lib/dashboard/DashboardTabContext';
import { SolicitudesSubProvider } from '../../lib/dashboard/SolicitudesSubContext';
import { TicketsSubProvider } from '../../lib/dashboard/TicketsSubContext';
import DashboardNav from './DashboardNav';
import SolicitudesHubView from './SolicitudesHubView';
import ActividadesAnalyticsView from './ActividadesAnalyticsView';
import TicketsHubView from './TicketsHubView';
import SolicitudesSubNav from './SolicitudesSubNav';
import TicketsSubNav from './TicketsSubNav';
import DashboardAdminGate from './DashboardAdminGate';

const MemoSolicitudesHub = memo(SolicitudesHubView);
const MemoActividades = memo(ActividadesAnalyticsView);
const MemoTickets = memo(TicketsHubView);

const panelClass = (active: boolean) =>
  active ? 'dashboard-panel dashboard-panel--active' : 'dashboard-panel';

function DashboardStickyChrome() {
  const { activeTab } = useDashboardTab();

  return (
    <div className='dashboard-sticky-chrome max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 pt-2 sm:pt-4 min-w-0'>
      <DashboardNav />
      {activeTab === 'solicitudes' ? (
        <div className='dashboard-subnav-slot min-w-0'>
          <SolicitudesSubNav />
        </div>
      ) : null}
      {activeTab === 'tickets' ? (
        <div className='dashboard-subnav-slot min-w-0'>
          <TicketsSubNav />
        </div>
      ) : null}
    </div>
  );
}

function DashboardViews() {
  const { activeTab } = useDashboardTab();

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }, [activeTab]);

  return (
    <div className='dashboard-panels'>
      <div className={panelClass(activeTab === 'solicitudes')} aria-hidden={activeTab !== 'solicitudes'}>
        <MemoSolicitudesHub />
      </div>
      <div className={panelClass(activeTab === 'actividades')} aria-hidden={activeTab !== 'actividades'}>
        <MemoActividades />
      </div>
      <div className={panelClass(activeTab === 'tickets')} aria-hidden={activeTab !== 'tickets'}>
        <MemoTickets />
      </div>
    </div>
  );
}

function RoutePrefetcher() {
  const router = useRouter();

  useEffect(() => {
    router.prefetch('/process');
  }, [router]);

  return null;
}

export default function DashboardShell() {
  return (
    <DashboardAdminGate>
      <DashboardDataProvider>
        <DashboardTabProvider>
          <SolicitudesSubProvider>
            <TicketsSubProvider>
              <RoutePrefetcher />
              <DashboardStickyChrome />
              <DashboardViews />
            </TicketsSubProvider>
          </SolicitudesSubProvider>
        </DashboardTabProvider>
      </DashboardDataProvider>
    </DashboardAdminGate>
  );
}
