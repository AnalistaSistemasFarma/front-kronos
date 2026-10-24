'use client';

import { memo, useEffect, useState } from 'react';
import { useSolicitudesSub } from '../../lib/dashboard/SolicitudesSubContext';
import SolicitudesAnalyticsView from './SolicitudesAnalyticsView';
import ProcesosAnalyticsView from './ProcesosAnalyticsView';

const MemoSolicitudes = memo(SolicitudesAnalyticsView);
const MemoProcesos = memo(ProcesosAnalyticsView);

const panelClass = (active: boolean) =>
  active ? 'dashboard-panel dashboard-panel--active' : 'dashboard-panel';

function SolicitudesPanels() {
  const { subView } = useSolicitudesSub();
  // Cada sub-vista se monta al abrirla por primera vez (antes todas, ocultas, con sus gráficas).
  const [visited, setVisited] = useState(() => new Set([subView]));
  if (!visited.has(subView)) setVisited(new Set(visited).add(subView));

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }, [subView]);

  return (
    <div className='dashboard-panels'>
      <div className={panelClass(subView === 'solicitudes')} aria-hidden={subView !== 'solicitudes'}>
        {visited.has('solicitudes') ? <MemoSolicitudes /> : null}
      </div>
      <div className={panelClass(subView === 'procesos')} aria-hidden={subView !== 'procesos'}>
        {visited.has('procesos') ? <MemoProcesos /> : null}
      </div>
    </div>
  );
}

export default function SolicitudesHubView() {
  return <SolicitudesPanels />;
}
