'use client';

import { memo, useEffect } from 'react';
import { useSolicitudesSub } from '../../lib/dashboard/SolicitudesSubContext';
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
    <div className='dashboard-panels'>
      <div className={panelClass(subView === 'solicitudes')} aria-hidden={subView !== 'solicitudes'}>
        <MemoSolicitudes />
      </div>
      <div className={panelClass(subView === 'procesos')} aria-hidden={subView !== 'procesos'}>
        <MemoProcesos />
      </div>
    </div>
  );
}

export default function SolicitudesHubView() {
  return <SolicitudesPanels />;
}
