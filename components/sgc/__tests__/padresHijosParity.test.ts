import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';

/**
 * LINEAMIENTOS de las pantallas nuevas (documentos padre e hijos y grilla del
 * encabezado, 2026-10-19): se arman con los mismos componentes compartidos del
 * SGC (tarjeta Mantine con borde, distintivo de estado SgcStatusBadge, código
 * en monoespaciado con su versión, botones Mantine) y no con estilos propios.
 * Se renderizan sin red, con datos de ejemplo.
 */
const graph = {
  nodes: [
    { id: 1, code: 'OLP-GGC-01-PR', title: 'Control de documentos', versionNumber: 2, status: 'vigente', idProcessType: 1, processTypeCode: 'S', processType: 'Soporte', processTypeColor: 'blue', idProcess: 1, process: 'GGC · Garantía de calidad', idDepartment: null, idDocumentType: 1, documentTypeCode: 'PR', currentVersionId: 10 },
    { id: 2, code: 'OLP-GGC-01-FR-001', title: 'Listado maestro', versionNumber: 1, status: 'vigente', idProcessType: 1, processTypeCode: 'S', processType: 'Soporte', processTypeColor: 'blue', idProcess: 1, process: 'GGC · Garantía de calidad', idDepartment: null, idDocumentType: 2, documentTypeCode: 'FR', currentVersionId: 20 },
    { id: 3, code: 'OLP-SEM-02-MN', title: 'Manual de tecnovigilancia', versionNumber: 1, status: 'vigente', idProcessType: 1, processTypeCode: 'S', processType: 'Soporte', processTypeColor: 'blue', idProcess: 2, process: 'SEM · Seguridad', idDepartment: null, idDocumentType: 3, documentTypeCode: 'MN', currentVersionId: 30 },
  ],
  edges: [{ id: 1, source: 2, target: 1, type: 'formato', note: null }],
  layout: {},
  processTypeOrder: [1],
  parentTypeCodes: ['PR'],
};

vi.mock('../useSgcFetch', () => ({
  useSgcFetch: (url: string | null) => ({ data: url?.startsWith('/api/sgc/relations?') ? graph : null, error: null, loading: false, reload: () => undefined }),
  sgcSend: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/process/sgc-documental/arbol', useSearchParams: () => new URLSearchParams() }));

const render = (el: ReactElement) => renderToStaticMarkup(createElement(MantineProvider, null, el));
const company = { idCompany: 3, companyName: 'ONELATAMPHARMA', canRead: true, canManage: true, canQuality: true, canAdminFlows: false };

describe('SGC · lineamientos de padres e hijos y de la grilla del encabezado', () => {
  it('[SGC-REQ-184] el árbol usa la tarjeta, el distintivo de estado y el código con versión de los demás módulos', async () => {
    const { default: SgcDocumentTree } = await import('../relations/SgcDocumentTree');
    const { SgcStatusBadge } = await import('../SgcBadges');
    const html = render(createElement(SgcDocumentTree, { company }));
    expect(html).toContain('mantine-Card-root');
    // El distintivo de estado es el mismo componente compartido (mismo marcado).
    const badge = render(createElement(SgcStatusBadge, { status: 'vigente' }));
    expect(html).toContain(badge.replace(/<style[\s\S]*?<\/style>/g, '').slice(0, 40));
    expect(html).toContain('OLP-GGC-01-PR');
    expect(html).toContain('V2');
    // Calidad ve los documentos sin padre con el botón accesible (funciona en el celular).
    expect(html).toContain('Documentos sin padre (1)');
    expect(html).toContain('Relacionar con padre');
    expect(html).not.toMatch(/style="[^"]*font-family:\s*(Arial|Times)/);
  });

  it('[SGC-REQ-185] el editor de la grilla usa los mismos controles de Mantine que «Encabezados» y avisa la grilla incompleta', async () => {
    const { default: SgcHeaderGridEditor } = await import('../SgcHeaderGridEditor');
    const { SGC_DEFAULT_HEADER_TEMPLATE } = await import('../../../lib/sgc/headerTemplates');
    const { SGC_DEFAULT_HEADER_GRID } = await import('../../../lib/sgc/headerGrid');
    const off = render(createElement(SgcHeaderGridEditor, { config: SGC_DEFAULT_HEADER_TEMPLATE, onChange: () => undefined }));
    expect(off).toContain('mantine-Card-root');
    expect(off).toContain('mantine-Switch-root');
    const on = render(createElement(SgcHeaderGridEditor, { config: { ...SGC_DEFAULT_HEADER_TEMPLATE, grid: SGC_DEFAULT_HEADER_GRID }, onChange: () => undefined }));
    expect(on).toContain('mantine-Button-root');
    expect((on.match(/data-testid="sgc-grilla-celda"/g) ?? []).length).toBe(12);
    expect(on).not.toContain('sgc-grilla-problema');
    const broken = render(createElement(SgcHeaderGridEditor, { config: { ...SGC_DEFAULT_HEADER_TEMPLATE, grid: { ...SGC_DEFAULT_HEADER_GRID, cells: SGC_DEFAULT_HEADER_GRID.cells.filter((c) => c.field !== 'fecha_emision') } }, onChange: () => undefined }));
    expect(broken).toContain('sgc-grilla-problema');
  });
});
