'use client';

import { memo, useEffect, useState } from 'react';
import { useTicketsSub } from '../../lib/dashboard/TicketsSubContext';
import TicketsAnalyticsView from './TicketsAnalyticsView';
import TicketsCategoryCompanyView from '@/components/dashboard/TicketsCategoryCompanyView';
import TicketsSubcategoryCompanyView from '@/components/dashboard/TicketsSubcategoryCompanyView';
import TicketsSubcategoryActivityView from '@/components/dashboard/TicketsSubcategoryActivityView';

const MemoOperativo = memo(TicketsAnalyticsView);
const MemoCategorias = memo(TicketsCategoryCompanyView);
const MemoSubcategorias = memo(TicketsSubcategoryCompanyView);
const MemoActividades = memo(TicketsSubcategoryActivityView);

const panelClass = (active: boolean) =>
  active ? 'dashboard-panel dashboard-panel--active' : 'dashboard-panel';

function TicketsPanels() {
  const { subView } = useTicketsSub();
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
      <div className={panelClass(subView === 'operativo')} aria-hidden={subView !== 'operativo'}>
        {visited.has('operativo') ? <MemoOperativo /> : null}
      </div>
      <div className={panelClass(subView === 'categorias')} aria-hidden={subView !== 'categorias'}>
        {visited.has('categorias') ? <MemoCategorias /> : null}
      </div>
      <div
        className={panelClass(subView === 'subcategorias')}
        aria-hidden={subView !== 'subcategorias'}
      >
        {visited.has('subcategorias') ? <MemoSubcategorias /> : null}
      </div>
      <div
        className={panelClass(subView === 'actividades')}
        aria-hidden={subView !== 'actividades'}
      >
        {visited.has('actividades') ? <MemoActividades /> : null}
      </div>
    </div>
  );
}

export default function TicketsHubView() {
  return <TicketsPanels />;
}
