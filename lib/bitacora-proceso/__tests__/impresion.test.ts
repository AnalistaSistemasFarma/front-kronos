import { describe, expect, it } from 'vitest';
import {
  buildInformePrintCss,
  mmACm,
  normalizarMargenSuperiorMm,
  OT_MARGEN_SUPERIOR_DEFAULT_MM,
  parseMargenSuperiorCm,
} from '../impresion';

// Case #8316: the printed Bitácora must leave the batch-record header area blank on every page.

describe('normalizarMargenSuperiorMm', () => {
  it('defaults to 4 cm when the value is missing or not numeric', () => {
    expect(OT_MARGEN_SUPERIOR_DEFAULT_MM).toBe(40);
    for (const v of [undefined, null, '', 'x', NaN, Infinity]) expect(normalizarMargenSuperiorMm(v)).toBe(40);
  });
  it('clamps to 0..120 mm and rounds', () => {
    expect(normalizarMargenSuperiorMm(-5)).toBe(0);
    expect(normalizarMargenSuperiorMm(500)).toBe(120);
    expect(normalizarMargenSuperiorMm(44.6)).toBe(45);
    expect(normalizarMargenSuperiorMm('35')).toBe(35);
  });
});

describe('parseMargenSuperiorCm', () => {
  it('accepts cm with dot or comma decimals and returns mm', () => {
    expect(parseMargenSuperiorCm(4)).toBe(40);
    expect(parseMargenSuperiorCm('4,5')).toBe(45);
    expect(parseMargenSuperiorCm('3.2')).toBe(32);
    expect(parseMargenSuperiorCm(0)).toBe(0);
    expect(parseMargenSuperiorCm(12)).toBe(120);
  });
  it('rejects out-of-range or non-numeric values', () => {
    for (const v of [-0.5, 12.1, 'abc', '', null, undefined, {}]) expect(parseMargenSuperiorCm(v)).toBeNull();
  });
  it('mmACm', () => {
    expect(mmACm(45)).toBe(4.5);
  });
});

describe('buildInformePrintCss', () => {
  it('reserves the configured top margin on every page (A4, @page)', () => {
    const css = buildInformePrintCss(40, 'BP-0001');
    expect(css).toMatch(/@page\s*\{[^}]*size: A4;/);
    expect(css).toContain('margin: 40mm 14mm 14mm 14mm;');
  });
  it('uses the default margin when the value is invalid and clamps big values', () => {
    expect(buildInformePrintCss(Number.NaN, 'x')).toContain('margin: 40mm 14mm');
    expect(buildInformePrintCss(999, 'x')).toContain('margin: 120mm 14mm');
    expect(buildInformePrintCss(0, 'x')).toContain('margin: 0mm 14mm');
  });
  it('numbers the pages in the bottom margin and escapes the footer text', () => {
    const css = buildInformePrintCss(40, 'BP-0001 "lote" \\n');
    expect(css).toContain('content: "Página " counter(page) " de " counter(pages)');
    expect(css).toContain('content: "BP-0001 \\"lote\\" \\\\n"');
  });
  it('cannot close the <style> tag from the footer text', () => {
    expect(buildInformePrintCss(40, 'L1</style><script>')).not.toMatch(/<\/style>|<script>/);
  });
  it('keeps the report-only print rules', () => {
    const css = buildInformePrintCss(40, 'x');
    expect(css).toContain('.ot-tabla-impresion thead { display: table-header-group; }');
    expect(css).toContain('.ot-bloque-final { break-inside: avoid;');
  });
});
