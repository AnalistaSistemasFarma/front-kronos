import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  SGC_DEFAULT_HEADER_GRID,
  SGC_HEADER_GRID_MAX_HEIGHT,
  addLine,
  canMerge,
  headerGridProblem,
  headerGridRects,
  mergeCell,
  normalizeHeaderGrid,
  removeLastLine,
  splitCell,
  type SgcHeaderGrid,
} from '../headerGrid';
import { SGC_DEFAULT_HEADER_TEMPLATE, describeHeaderTemplateChanges, normalizeHeaderTemplateConfig, parseHeaderTemplateConfig } from '../headerTemplates';
import { drawInstitutionalHeaders, gridCellLabel, institutionalSignatureBoxesPct, suggestInstitutionalPlacements, type SgcInstitutionalHeaderData } from '../pdf/institutional';

/**
 * ENCABEZADO CON GRILLA (fase 1, reunión con Calidad OLP del 2026-10-19):
 * filas y columnas, celdas combinadas, el campo de cada celda, logo y textos
 * fijos; la vista previa usa la misma función que compone el PDF controlado.
 */

async function pdfText(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNumber);
  const tc = await page.getTextContent();
  return (tc.items as { str: string }[]).map((i) => i.str).join(' ');
}

const header = (over: Partial<SgcInstitutionalHeaderData> = {}): SgcInstitutionalHeaderData => ({
  company: 'ONE LATAM PHARMA',
  title: 'Procedimiento de control de documentos y registros',
  code: 'OLP-GGC-01-PR',
  versionLabel: '3',
  process: 'GGC · Gestión de garantía de calidad',
  documentType: 'Procedimiento',
  elaboro: ['Persona que elabora · Analista'],
  reviso: ['Persona que revisa · Jefe'],
  aprobo: ['Persona que aprueba · Directora'],
  emissionText: 'Al quedar vigente',
  logo: null,
  ...over,
});

/** Grilla de 3 columnas como la de un formato: logo | nombre | código-versión-página; firmas; texto fijo. */
const FORMATO: SgcHeaderGrid = {
  columns: [20, 50, 30],
  rows: [40, 26, 34, 16],
  cells: [
    { row: 0, col: 0, rowSpan: 2, colSpan: 1, field: 'logo' },
    { row: 0, col: 1, rowSpan: 1, colSpan: 1, field: 'nombre', label: 'NOMBRE DEL FORMATO' },
    { row: 0, col: 2, rowSpan: 1, colSpan: 1, field: 'codigo_version_pagina' },
    { row: 1, col: 1, rowSpan: 1, colSpan: 1, field: 'proceso' },
    { row: 1, col: 2, rowSpan: 1, colSpan: 1, field: 'fecha_emision' },
    { row: 2, col: 0, rowSpan: 1, colSpan: 1, field: 'firma_elaboro', label: 'ELABORÓ' },
    { row: 2, col: 1, rowSpan: 1, colSpan: 1, field: 'firma_reviso', label: 'REVISÓ' },
    { row: 2, col: 2, rowSpan: 1, colSpan: 1, field: 'firma_aprobo', label: 'APROBÓ' },
    { row: 3, col: 0, rowSpan: 1, colSpan: 3, field: 'texto', text: 'Documento controlado: prohibida su reproducción' },
  ],
};

describe('SGC · encabezado con grilla · validación', () => {
  it('[SGC-REQ-185] la grilla por defecto (institucional en 4 columnas) y la de un formato son válidas y se normalizan', () => {
    expect(normalizeHeaderGrid(SGC_DEFAULT_HEADER_GRID)).toEqual(SGC_DEFAULT_HEADER_GRID);
    const g = normalizeHeaderGrid(FORMATO);
    expect(g.cells.find((c) => c.field === 'logo')).toMatchObject({ rowSpan: 2, align: 'center' });
    expect(g.cells.find((c) => c.field === 'nombre')?.label).toBe('NOMBRE DEL FORMATO');
    expect(headerGridProblem(FORMATO)).toBeNull();
  });

  it('[SGC-REQ-185] rechaza solapes, casillas sin celda, celdas fuera de la grilla, alto mayor al espacio del encabezado y campos repetidos u obligatorios ausentes', () => {
    const base = normalizeHeaderGrid(FORMATO);
    const over = { ...base, cells: [...base.cells, { row: 0, col: 1, rowSpan: 1, colSpan: 1, field: 'vacio' as const }] };
    expect(() => normalizeHeaderGrid(over)).toThrow(/se solapan/);
    expect(() => normalizeHeaderGrid({ ...base, cells: base.cells.filter((c) => c.field !== 'proceso') })).toThrow(/sin celda: fila 2, columna 2/);
    expect(() => normalizeHeaderGrid({ ...base, cells: base.cells.map((c) => (c.field === 'texto' ? { ...c, colSpan: 4 } : c)) })).toThrow(/posición inválida|se sale/);
    expect(() => normalizeHeaderGrid({ ...base, rows: [80, 26, 34, 16] })).toThrow(`máximo es ${SGC_HEADER_GRID_MAX_HEIGHT}`);
    expect(() => normalizeHeaderGrid({ ...base, rows: [8, 26, 34, 16] })).toThrow(/alto de la fila 1/);
    expect(() => normalizeHeaderGrid({ ...base, columns: [0, 50, 30] })).toThrow(/ancho de la columna 1/);
    expect(() => normalizeHeaderGrid({ ...base, cells: base.cells.map((c) => (c.field === 'proceso' ? { ...c, field: 'nombre' as const } : c)) })).toThrow(/una sola celda/);
    expect(() => normalizeHeaderGrid({ ...base, cells: base.cells.map((c) => (c.field === 'fecha_emision' ? { ...c, field: 'vacio' as const } : c)) })).toThrow(/falta la fecha de emisión/);
    expect(() => normalizeHeaderGrid({ ...base, cells: base.cells.map((c) => (c.field === 'firma_reviso' ? { ...c, field: 'reviso' as const } : c)) })).toThrow(/firma de quien revisó/);
    expect(() => normalizeHeaderGrid({ ...base, cells: base.cells.map((c) => (c.field === 'proceso' ? { ...c, field: 'codigo' as const } : c)) })).toThrow(/no ambos/);
    expect(() => normalizeHeaderGrid({ ...base, cells: base.cells.map((c) => (c.field === 'proceso' ? { ...c, field: 'otro' } : c)) })).toThrow(/campo no permitido/);
    expect(() => normalizeHeaderGrid({ ...base, cells: base.cells.map((c) => (c.field === 'texto' ? { ...c, text: '  ' } : c)) })).toThrow(/Escriba el texto fijo/);
    expect(() => normalizeHeaderGrid({ columns: [], rows: [10], cells: [] })).toThrow(/columnas/);
    expect(() => normalizeHeaderGrid('basura')).toThrow(/no es válida/);
  });

  it('[SGC-REQ-185] la plantilla guarda su grilla (o ninguna) y el control de cambios dice qué cambió', () => {
    expect(normalizeHeaderTemplateConfig({}).grid).toBeNull();
    const cfg = normalizeHeaderTemplateConfig({ titleLabel: 'Nombre del formato', grid: FORMATO });
    expect(cfg.grid?.cells).toHaveLength(9);
    expect(parseHeaderTemplateConfig(JSON.stringify(cfg)).grid).toEqual(cfg.grid);
    expect(() => normalizeHeaderTemplateConfig({ grid: { ...FORMATO, rows: [80, 80, 34, 16] } })).toThrow(/máximo es/);
    expect(describeHeaderTemplateChanges(SGC_DEFAULT_HEADER_TEMPLATE, { ...SGC_DEFAULT_HEADER_TEMPLATE, grid: normalizeHeaderGrid(FORMATO) })).toEqual(['grilla: «tabla institucional» → «4 fila(s) × 3 columna(s), 9 celda(s)»']);
    const g2 = normalizeHeaderGrid({ ...FORMATO, cells: FORMATO.cells.map((c) => (c.field === 'texto' ? { ...c, text: 'Otro texto' } : c)) });
    expect(describeHeaderTemplateChanges({ ...SGC_DEFAULT_HEADER_TEMPLATE, grid: normalizeHeaderGrid(FORMATO) }, { ...SGC_DEFAULT_HEADER_TEMPLATE, grid: g2 })[0]).toMatch(/cambió el contenido de las celdas/);
  });
});

describe('SGC · encabezado con grilla · editor', () => {
  it('[SGC-REQ-185] combinar a la derecha y hacia abajo, separar, agregar y quitar filas y columnas mantiene la grilla cubierta', () => {
    let g = normalizeHeaderGrid(SGC_DEFAULT_HEADER_GRID);
    const elaboro = g.cells.findIndex((c) => c.field === 'elaboro');
    expect(canMerge(g, elaboro, 'derecha')).toBe(true);
    g = mergeCell(g, elaboro, 'derecha');
    expect(g.cells.find((c) => c.field === 'elaboro')).toMatchObject({ colSpan: 2 });
    expect(g.cells.some((c) => c.field === 'reviso')).toBe(false);
    // El nombre (2 columnas) no se combina hacia abajo con una celda de 1 columna.
    expect(canMerge(g, g.cells.findIndex((c) => c.field === 'nombre'), 'abajo')).toBe(false);
    g = splitCell(g, g.cells.findIndex((c) => c.field === 'elaboro'));
    expect(g.cells.filter((c) => c.row === 1).map((c) => c.field)).toEqual(['elaboro', 'vacio', 'aprobo', 'texto']);
    g = addLine(addLine(g, 'fila'), 'columna');
    expect([g.rows.length, g.columns.length, g.cells.length]).toEqual([5, 5, 12 - 1 + 1 + 4 + 5]);
    g = removeLastLine(removeLastLine(g, 'fila'), 'columna');
    expect([g.rows.length, g.columns.length]).toEqual([4, 4]);
    // Los nombres de «Revisó» son opcionales: la grilla sigue válida.
    expect(headerGridProblem(g)).toBeNull();
    // Quitar la última columna recorta la fila inferior combinada y se lleva la fecha de emisión: el editor lo avisa sin lanzar.
    const cut = removeLastLine(g, 'columna');
    expect(cut.cells.find((c) => c.field === 'proceso_tipo')).toMatchObject({ colSpan: 3 });
    expect(headerGridProblem(cut)).toMatch(/fecha de emisión/);
    const sinFirma = { ...g, cells: g.cells.map((c) => (c.field === 'firma_reviso' ? { ...c, field: 'vacio' as const } : c)) };
    expect(headerGridProblem(sinFirma)).toMatch(/firma de quien revisó/);
  });
});

describe('SGC · encabezado con grilla · PDF', () => {
  it('[SGC-REQ-185] las celdas caen dentro del espacio del encabezado y la firma sugerida va en su celda «Firma»', () => {
    const g = normalizeHeaderGrid(FORMATO);
    const rects = headerGridRects(g, 595.28, 841.89);
    const bottom = Math.min(...rects.map((r) => r.rect.y));
    expect(841.89 - 28 - bottom).toBeCloseTo(116, 5);
    const firma = rects.find((r) => r.cell.field === 'firma_reviso')!.rect;
    const boxes = institutionalSignatureBoxesPct(595.28, 841.89, g);
    expect(boxes.reviso.x).toBeCloseTo(((firma.x + 3) / 595.28) * 100, 5);
    expect(boxes.reviso.width).toBeCloseTo(((firma.width - 6) / 595.28) * 100, 5);
    // Sin grilla: los recuadros institucionales de siempre.
    expect(institutionalSignatureBoxesPct()).toEqual(institutionalSignatureBoxesPct(595.28, 841.89, null));
    const sug = suggestInstitutionalPlacements([{ key: 'a', meaning: 'reviso', name: 'Persona', email: 'p@x.com', role: 'Revisó' }], [], g);
    expect(sug[0]).toMatchObject({ page: 1, x: Math.round(boxes.reviso.x * 100) / 100 });
  });

  it('[SGC-REQ-185] el PDF dibuja la grilla con sus campos, rótulos y texto fijo; la fecha de emisión sale de su celda; las demás páginas llevan el encabezado corto', async () => {
    const pdf = await PDFDocument.create();
    const pages = [pdf.addPage([595.28, 841.89]), pdf.addPage([595.28, 841.89])];
    const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
    const tpl = normalizeHeaderTemplateConfig({ grid: FORMATO });
    const drawn = await drawInstitutionalHeaders(pdf, pages, header({ template: tpl }), fonts);
    const cell = headerGridRects(tpl.grid!, 595.28, 841.89).find((r) => r.cell.field === 'fecha_emision')!.rect;
    expect(drawn.emission).toEqual({ x: cell.x + 1, y: cell.y + 1, width: cell.width - 2, height: cell.height - 2 });
    const bytes = await pdf.save();
    const first = await pdfText(bytes, 1);
    for (const t of ['NOMBRE DEL FORMATO', 'CÓDIGO: OLP-GGC-01-PR', 'VERSIÓN: 3', 'PÁGINA 1 DE 2', 'PROCESO: GGC', 'FECHA DE EMISIÓN:', 'ELABORÓ', 'REVISÓ', 'APROBÓ', 'Documento controlado: prohibida su reproducción', 'ONE LATAM PHARMA']) expect(first).toContain(t);
    // La grilla de este formato no lleva los nombres de los firmantes (no tiene esas celdas).
    expect(first).not.toContain('Persona que revisa');
    expect(await pdfText(bytes, 2)).toContain('CÓDIGO: OLP-GGC-01-PR · VERSIÓN: 3');
  });

  it('[SGC-REQ-185] el rótulo de cada celda: el propio, ninguno o el de la plantilla', () => {
    const t = normalizeHeaderTemplateConfig({ codeLabel: 'Cód.' });
    expect(gridCellLabel({ row: 0, col: 0, rowSpan: 1, colSpan: 1, field: 'codigo' }, t)).toBe('CÓD.');
    expect(gridCellLabel({ row: 0, col: 0, rowSpan: 1, colSpan: 1, field: 'codigo', label: 'REF' }, t)).toBe('REF');
    expect(gridCellLabel({ row: 0, col: 0, rowSpan: 1, colSpan: 1, field: 'fecha_emision', label: '' }, t)).toBe('');
    expect(gridCellLabel({ row: 0, col: 0, rowSpan: 1, colSpan: 1, field: 'logo' }, t)).toBe('');
  });
});
