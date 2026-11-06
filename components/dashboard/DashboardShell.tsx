'use client';

import { memo, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardDataProvider } from '../../lib/dashboard/DashboardDataContext';
import { DashboardTabProvider, useDashboardTab } from '../../lib/dashboard/DashboardTabContext';
import { SolicitudesSubProvider } from '../../lib/dashboard/SolicitudesSubContext';
import { TicketsSubProvider } from '../../lib/dashboard/TicketsSubContext';
import DashboardNav from './DashboardNav';
import SolicitudesHubView from './SolicitudesHubView';
import ActividadesAnalyticsView from './ActividadesAnalyticsView';
import TicketsHubView from './TicketsHubView';
import AgentesAnalyticsView from './AgentesAnalyticsView';
import SolicitudesSubNav from './SolicitudesSubNav';
import TicketsSubNav from './TicketsSubNav';
import DashboardAdminGate from './DashboardAdminGate';

const MemoSolicitudesHub = memo(SolicitudesHubView);
const MemoActividades = memo(ActividadesAnalyticsView);
const MemoTickets = memo(TicketsHubView);
const MemoAgentes = memo(AgentesAnalyticsView);

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
  // Cada pestaña se monta la primera vez que se abre y luego se conserva (cambio instantáneo).
  // Antes se montaban las 4 ocultas y cada una pedía sus datos (agentes, tickets...) sin verse.
  const [visited, setVisited] = useState(() => new Set([activeTab]));
  if (!visited.has(activeTab)) setVisited(new Set(visited).add(activeTab));

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }, [activeTab]);

  return (
    <div className='dashboard-panels'>
      <div className={panelClass(activeTab === 'solicitudes')} aria-hidden={activeTab !== 'solicitudes'}>
        {visited.has('solicitudes') ? <MemoSolicitudesHub /> : null}
      </div>
      <div className={panelClass(activeTab === 'actividades')} aria-hidden={activeTab !== 'actividades'}>
        {visited.has('actividades') ? <MemoActividades /> : null}
      </div>
      <div className={panelClass(activeTab === 'tickets')} aria-hidden={activeTab !== 'tickets'}>
        {visited.has('tickets') ? <MemoTickets /> : null}
      </div>
      <div className={panelClass(activeTab === 'agentes')} aria-hidden={activeTab !== 'agentes'}>
        {visited.has('agentes') ? <MemoAgentes /> : null}
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
