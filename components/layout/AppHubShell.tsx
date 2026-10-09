'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useAppSection } from '../../lib/navigation/AppSectionContext';
import { isHubInstantSwapRoute } from '../../lib/navigation/AppSectionContext';

// Carga diferida: el tablero (vistas de análisis + chart.js) y la vista de procesos ya no van
// en el paquete del layout, que comparten TODAS las pantallas del hub (solicitudes, tickets...).
const DashboardShell = dynamic(() => import('../dashboard/DashboardShell'));
const ProcessView = dynamic(() => import('../process/ProcessView'));

function HubPanels() {
  const { activeSection } = useAppSection();
  // Cada panel se monta la primera vez que se abre y luego se conserva (cambio instantáneo).
  // Antes el tablero se montaba oculto en /process y disparaba sus consultas sin verse.
  const [visited, setVisited] = useState(() => new Set([activeSection]));
  if (!visited.has(activeSection)) setVisited(new Set(visited).add(activeSection));

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
        {visited.has('dashboard') ? <DashboardShell /> : null}
      </div>
      <div
        className={panelClass(activeSection === 'process')}
        aria-hidden={activeSection !== 'process'}
      >
        {visited.has('process') ? <ProcessView /> : null}
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
