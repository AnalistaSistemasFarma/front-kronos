'use client';

import { memo, useEffect } from 'react';
import { SolicitudesSubProvider, useSolicitudesSub } from '../../lib/dashboard/SolicitudesSubContext';
import SolicitudesSubNav from './SolicitudesSubNav';
import SolicitudesAnalyticsView from './SolicitudesAnalyticsView';
import ProcesosAnalyticsView from './ProcesosAnalyticsView';

const MemoSolicitudes = memo(SolicitudesAnalyticsView);
const MemoProcesos = memo(ProcesosAnalyticsView);

const panelClass = (active: boolean) =>
  active ? 'dashboard-panel dashboard-panel--active' : 'dashboard-panel';

function SolicitudesPanels() {
  const { subView } = useSolicitudesSub();

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }, [subView]);

  return (
    <>
      <div className='dashboard-subnav-sticky max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 min-w-0'>
        <SolicitudesSubNav />
      </div>
      <div className='dashboard-panels'>
        <div className={panelClass(subView === 'solicitudes')} aria-hidden={subView !== 'solicitudes'}>
          <MemoSolicitudes />
        </div>
        <div className={panelClass(subView === 'procesos')} aria-hidden={subView !== 'procesos'}>
          <MemoProcesos />
        </div>
      </div>
    </>
  );
}

export default function SolicitudesHubView() {
  return (
    <SolicitudesSubProvider>
      <SolicitudesPanels />
    </SolicitudesSubProvider>
  );
}
