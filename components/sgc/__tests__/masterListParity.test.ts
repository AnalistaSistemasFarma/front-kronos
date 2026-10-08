import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';

/**
 * PARIDAD de «Cargar listado maestro (Excel)» del SGC (Sprint 8) con el
 * cargue masivo de SynerLink (Registros sanitarios). Regla de Nicolás: las
 * pantallas del SGC con equivalente en SynerLink se copian IDÉNTICAS. Se
 * renderizan los dos modales abiertos (el marco del modal se dibuja en línea
 * para poder compararlo en Node) y se compara el marcado de los botones y de
 * los grupos de acciones: etiquetas, clases y estilos. Diferencias declaradas:
 * el selector «Empresa» (en el SGC la empresa sale del selector del módulo),
 * los textos propios del listado y los data-testid de las pruebas.
 */

vi.mock('@mantine/core', async (orig) => {
  const real = await orig<typeof import('@mantine/core')>();
  const Modal = ({ opened, title, children }: { opened: boolean; title: ReactNode; children: ReactNode }) => (opened ? createElement('section', { 'data-modal': '' }, createElement('h2', null, title), children) : null);
  return { ...real, Modal };
});

const render = (el: ReactElement) => renderToStaticMarkup(createElement(MantineProvider, null, el));
const normalize = (html: string) =>
  html
    .replace(/ data-testid="[^"]*"/g, '')
    .replace(/(id|for|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, '$1=""');
const buttons = (html: string) => [...normalize(html).matchAll(/<button\b[\s\S]*?<\/button>/g)].map((m) => m[0]);
const labels = (html: string) => buttons(html).map((b) => b.replace(/<[^>]+>/g, '').trim());

describe('SGC · paridad de «Cargar listado maestro» con el cargue masivo de SynerLink', () => {
  it('[SGC-REQ-114] los botones del modal del SGC tienen el mismo marcado, clases, estilos y textos que los del cargue masivo de SynerLink', async () => {
    const { default: Synerlink } = await import('../../../app/(hub)/process/health-records/BulkModal');
    const { default: Sgc } = await import('../SgcMasterListImportModal');
    const a = render(createElement(Synerlink, { opened: true, onClose: () => undefined, companies: [{ idCompany: 3, companyName: 'OLP' }], onLoaded: () => undefined }));
    const b = render(createElement(Sgc, { opened: true, onClose: () => undefined, idCompany: 3, catalogs: { company: 'OLP', processes: [], documentTypes: [] }, onLoaded: () => undefined }));
    expect(labels(a)).toEqual(['Descargar plantilla', 'Subir archivo', 'Cerrar', 'Simular', 'Cargar']);
    expect(labels(b)).toEqual(labels(a));
    expect(buttons(b)).toEqual(buttons(a));
    // El marco: título del modal y el mismo orden de bloques (sin el selector de empresa).
    expect(a).toContain('Cargue masivo de registros sanitarios');
    expect(b).toContain('Cargar listado maestro (Excel)');
    const groups = (html: string) => (normalize(html).match(/<div class="[^"]*mantine-Group-root[^"]*"[^>]*>/g) ?? []);
    expect(groups(b)).toEqual(groups(a));
  });
});
