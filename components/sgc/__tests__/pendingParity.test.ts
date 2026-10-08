import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { IconClipboardList } from '@tabler/icons-react';
import { describe, expect, it, vi } from 'vitest';

/**
 * PARIDAD de las tarjetas de «Mis pendientes del SGC» (Sprint 9) con el
 * «KpiCard» de los tableros de solicitudes de SynerLink
 * (components/request-general/RequestRoleDashboard.tsx). Se renderiza el
 * tablero de SynerLink, se extrae su primera tarjeta y se compara con la
 * copia del SGC con los mismos datos.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

const render = (el: ReactElement) => renderToStaticMarkup(createElement(MantineProvider, null, el));
const normalize = (html: string) => html.replace(/<style\b[\s\S]*?<\/style>/g, '').replace(/(id|for|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, '$1=""');

/** Primer elemento balanceado que empieza en `start` (cuenta <div> abiertos y cerrados). */
function element(html: string, start: number): string {
  let depth = 0;
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start);
}

describe('SGC · paridad de «Mis pendientes» con los KpiCard de SynerLink', () => {
  it('[SGC-REQ-120] la tarjeta de pendientes del SGC tiene el mismo marcado, clases y estilos que el KpiCard de SynerLink', async () => {
    const { RequestRoleDashboard } = await import('../../request-general/RequestRoleDashboard');
    const { SgcKpiCard } = await import('../SgcPendingBoard');
    const counts = { total: 7, abierto: 1, enProgreso: 2, resuelto: 3, cancelado: 1, otros: 0 };
    const html = normalize(render(createElement(RequestRoleDashboard, { kind: 'solicitante', title: 'T', subtitle: 'S', requests: [], activities: [], requestCounts: counts, activityCounts: counts })));
    const kpis = [...html.matchAll(/<div style="[^"]*background-color:var\(--mantine-color-blue-light\)[^"]*" class="[^"]*mantine-Card-root/g)];
    expect(kpis.length).toBeGreaterThan(0);
    const synerlink = element(html, kpis[0].index!);
    expect(synerlink).toContain('Total procesos');
    const sgc = normalize(render(createElement(SgcKpiCard, { label: 'Total procesos', value: 7, color: 'blue', icon: createElement(IconClipboardList, { size: 22, color: 'var(--mantine-color-blue-light-color)' }) })));
    expect(sgc).toBe(synerlink);
  });
});
