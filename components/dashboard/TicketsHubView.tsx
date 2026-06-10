'use client';

import { memo, useEffect } from 'react';
import { useTicketsSub } from '../../lib/dashboard/TicketsSubContext';
import TicketsAnalyticsView from './TicketsAnalyticsView';
import TicketsCategoryCompanyView from '@/components/dashboard/TicketsCategoryCompanyView';

const MemoOperativo = memo(TicketsAnalyticsView);
const MemoCategorias = memo(TicketsCategoryCompanyView);

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
    </div>
  );
}

export default function TicketsHubView() {
  return <TicketsPanels />;
}
