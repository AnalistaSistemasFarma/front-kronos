'use client';

import { memo, useEffect } from 'react';
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

  useEffect(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }, [subView]);

  return (
    <div className='dashboard-panels'>
      <div className={panelClass(subView === 'operativo')} aria-hidden={subView !== 'operativo'}>
        <MemoOperativo />
      </div>
      <div className={panelClass(subView === 'categorias')} aria-hidden={subView !== 'categorias'}>
        <MemoCategorias />
      </div>
      <div
        className={panelClass(subView === 'subcategorias')}
        aria-hidden={subView !== 'subcategorias'}
      >
        <MemoSubcategorias />
      </div>
      <div
        className={panelClass(subView === 'actividades')}
        aria-hidden={subView !== 'actividades'}
      >
        <MemoActividades />
      </div>
    </div>
  );
}

export default function TicketsHubView() {
  return <TicketsPanels />;
}
