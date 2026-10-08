import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';

/**
 * PARIDAD de la pantalla «Ubicar firmas» del SGC con la de SynerLink
 * (correcciones de Calidad OLP, 2026-10-03; regla de Nicolás: las pantallas del
 * SGC con equivalente en SynerLink se copian IDÉNTICAS). Se renderizan con los
 * MISMOS datos el lienzo de ubicación, la lista «Orden de firma» y los pasos
 * de SynerLink (components/orion/**) y sus copias congeladas del SGC
 * (components/sgc/signature/**), y se compara el marcado: etiquetas, clases,
 * estilos y textos. Lo único que puede diferir es lo declarado abajo (rótulos
 * propios del SGC). La pantalla de SynerLink no se abre en la e2e porque
 * exige crear un documento en Orión (escribiría en un sistema externo).
 *
 * Esta prueba es la ÚNICA pieza del SGC que importa código de Orión, y solo
 * para compararlo: vive en __tests__ (fuera de la verificación de
 * aislamiento, que revisa el código que se ejecuta).
 */

const PAGES = [
  { page: 1, dataUrl: 'data:image/png;base64,AAAA', width: 714, height: 1010 },
  { page: 2, dataUrl: 'data:image/png;base64,BBBB', width: 714, height: 1010 },
];
vi.mock('../../../orion/usePdfPageImages', () => ({ usePdfPageImages: () => ({ pages: PAGES, loading: false, error: null }) }));
vi.mock('../useSgcPdfPageImages', () => ({ useSgcPdfPageImages: () => ({ pages: PAGES, loading: false, error: null }) }));

const people = [
  { order: 1, name: 'Elaboradora QA', email: 'elab@onelatampharma.com', role: 'Solicitante', signatureDataUrl: null, signatureMarkId: null },
  { order: 2, name: 'Revisor QA', email: 'rev@onelatampharma.com', role: 'Asignado', signatureDataUrl: null, signatureMarkId: null },
];
const fields = [
  { id: 'f1', documentId: 'DOC', signerOrder: 1, page: 1, x: 10, y: 15, width: 20, height: 6, label: 'Elaboró · Elaboradora QA', kind: 'validation' as const },
  { id: 'f2', documentId: 'DOC', signerOrder: 2, page: 2, x: 40, y: 70, width: 20, height: 6, label: 'Revisó · Revisor QA', kind: 'validation' as const },
];

const render = (el: ReactElement) => renderToStaticMarkup(createElement(MantineProvider, null, el));
/** Normaliza lo que React genera distinto en cada render (ids) para comparar marcado. */
const normalize = (html: string) => html.replace(/(id|for|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, '$1=""');

describe('SGC · paridad de «Ubicar firmas» con SynerLink', () => {
  it('[SGC-REQ-095] el lienzo de ubicación de firmas del SGC tiene el mismo marcado, estilos y textos que el de SynerLink', async () => {
    const { default: Orion } = await import('../../../orion/SignaturePlacementCanvas');
    const { default: Sgc } = await import('../SgcSignaturePlacementCanvas');
    const props = { pdfSrc: '/x.pdf', documentId: 'DOC', participants: people, activeOrder: 1, activeKind: 'validation' as const, fields, onChange: () => undefined };
    const a = normalize(render(createElement(Orion, props as never)));
    const b = normalize(render(createElement(Sgc, props as never)));
    expect(a).toContain('Ubique la firma de Elaboradora QA');
    expect(a).toContain('ELABORÓ · ELABORADORA QA');
    expect(b).toBe(a);
  });

  it('[SGC-REQ-095] la lista «Orden de firma» del SGC es la de SynerLink (los roles del SGC solo cambian el color del distintivo)', async () => {
    const { default: Orion } = await import('../../../orion/OrionSignersList');
    const { default: Sgc } = await import('../SgcSignersPlacementList');
    const props = { participants: people, activeOrder: 2, onSelect: () => undefined, fields, variant: 'placement' as const, sequential: false };
    const a = normalize(render(createElement(Orion, props as never)));
    const b = normalize(render(createElement(Sgc, props as never)));
    expect(a).toContain('Firma ubicada');
    expect(b).toBe(a);
    // Con los roles propios del SGC el marcado es el mismo salvo el color del distintivo del rol.
    const sgcRoles = people.map((p, i) => ({ ...p, role: i === 0 ? 'Elaboró' : 'Aprobó' }));
    const c = normalize(render(createElement(Sgc, { ...props, participants: sgcRoles } as never)));
    const colorless = (html: string) => html.replace(/--(badge|avatar)-(bg|color):[^;"]+;?/g, '');
    expect(colorless(c.replace(/Elaboró|Aprobó/g, 'ROL'))).toBe(colorless(a.replace(/Solicitante|Asignado/g, 'ROL')));
  });

  it('[SGC-REQ-095] los pasos de preparación del documento son los mismos de SynerLink (paso 3: «Ubicación»)', async () => {
    const { default: Orion, editorStepSubtitle: subOrion } = await import('../../../orion/OrionEditorSteps');
    const { default: Sgc, editorStepSubtitle: subSgc } = await import('../SgcEditorSteps');
    expect(normalize(render(createElement(Sgc, { active: 2 })))).toBe(normalize(render(createElement(Orion, { active: 2 }))));
    expect(subSgc(2)).toBe(subOrion(2));
    expect(subSgc(2)).toBe('Paso 3 de 3 — Dónde firman en el PDF');
  });
});
