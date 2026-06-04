'use client';

import { memo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardDataProvider } from '../../lib/dashboard/DashboardDataContext';
import { DashboardTabProvider, useDashboardTab } from '../../lib/dashboard/DashboardTabContext';
import DashboardNav from './DashboardNav';
import SolicitudesAnalyticsView from './SolicitudesAnalyticsView';
import ActividadesAnalyticsView from './ActividadesAnalyticsView';
import TicketsAnalyticsView from './TicketsAnalyticsView';
import DashboardAdminGate from './DashboardAdminGate';

const MemoSolicitudes = memo(SolicitudesAnalyticsView);
const MemoActividades = memo(ActividadesAnalyticsView);
const MemoTickets = memo(TicketsAnalyticsView);

const panelClass = (active: boolean) =>
  active ? 'dashboard-panel dashboard-panel--active' : 'dashboard-panel';

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
        <MemoSolicitudes />
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
          <RoutePrefetcher />
          <div className='dashboard-nav-sticky max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 pt-2 sm:pt-4 min-w-0'>
            <DashboardNav />
          </div>
          <DashboardViews />
        </DashboardTabProvider>
      </DashboardDataProvider>
    </DashboardAdminGate>
  );
}
