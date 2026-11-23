/**
 * Printing of the Bitácora report (case #8316, 2026-11-23, Farmalógica — Tatiana Rico):
 * the report is printed on the batch-record sheet, which already carries the batch header
 * at the top of EVERY page. The printed content must start below that header, so the top
 * page margin is configurable per company (ot_config.margen_superior_mm, default 40 mm = 4 cm).
 *
 * Pure module (no React, no Prisma): used by the API (validation) and the report (print CSS).
 */

/** Default reserved top area for the batch header, in millimetres (4 cm). */
export const OT_MARGEN_SUPERIOR_DEFAULT_MM = 40;
/** Allowed range for the reserved top area (0 = no header; 12 cm leaves room for content on A4). */
export const OT_MARGEN_SUPERIOR_MIN_MM = 0;
export const OT_MARGEN_SUPERIOR_MAX_MM = 120;
/** Remaining page margins (unchanged from the original report). */
export const OT_MARGEN_LATERAL_MM = 14;
export const OT_MARGEN_INFERIOR_MM = 14;

export const OT_MARGEN_SUPERIOR_LABEL = 'Margen superior para encabezado batch (cm)';
export const OT_MARGEN_SUPERIOR_AYUDA =
  'Espacio en blanco que se deja arriba en CADA página impresa para el encabezado del lote batch. El informe empieza debajo.';

/** Clamps and rounds a margin (mm) to the allowed range; anything non-numeric falls back to the default. */
export function normalizarMargenSuperiorMm(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return OT_MARGEN_SUPERIOR_DEFAULT_MM;
  return Math.min(OT_MARGEN_SUPERIOR_MAX_MM, Math.max(OT_MARGEN_SUPERIOR_MIN_MM, Math.round(n)));
}

/** Strict validation for the API: returns the margin in mm or null when the value is not acceptable. */
export function parseMargenSuperiorCm(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value.replace(',', '.')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const mm = Math.round(n * 10);
  if (mm < OT_MARGEN_SUPERIOR_MIN_MM || mm > OT_MARGEN_SUPERIOR_MAX_MM) return null;
  return mm;
}

export function mmACm(mm: number): number {
  return Math.round(mm) / 10;
}

/**
 * Print CSS for the report. The reserved top area is the @page top margin, so it repeats on
 * every page (multi-page prints included) and the table header (thead) repeats below it.
 * Page numbers go in the bottom margin box (Chrome/Edge 131+; older browsers just omit them).
 */
export function buildInformePrintCss(margenSuperiorMm: number, pie: string): string {
  const top = normalizarMargenSuperiorMm(margenSuperiorMm);
  // The text goes inside a <style> tag: no line breaks and no angle brackets (cannot close the tag).
  const pieCss = JSON.stringify(pie.replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '').slice(0, 120));
  return `
@media print {
  @page {
    size: A4;
    margin: ${top}mm ${OT_MARGEN_LATERAL_MM}mm ${OT_MARGEN_INFERIOR_MM}mm ${OT_MARGEN_LATERAL_MM}mm;
    @bottom-left { content: ${pieCss}; font-size: 8pt; color: #000; }
    @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 8pt; color: #000; }
  }
  html, body { background: #fff !important; }
  body * { visibility: hidden !important; }
  .ot-informe, .ot-informe * { visibility: visible !important; }
  /* Solo queda la hoja: se ocultan los hermanos de sus contenedores (menú, encabezado,
     botones) para que no generen páginas en blanco, y los contenedores no agregan alto. */
  body *:not(:has(.ot-informe)):not(.ot-informe):not(.ot-informe *) { display: none !important; }
  body *:has(.ot-informe) { min-height: 0 !important; height: auto !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; position: static !important; background: #fff !important; box-shadow: none !important; border: 0 !important; }
  .ot-informe { width: 100%; color: #000 !important; background: #fff !important; border: 0 !important; padding: 0 !important; margin: 0 !important; }
  .ot-informe .mantine-Card-root, .ot-informe .mantine-Paper-root { box-shadow: none !important; background: #fff !important; border-color: #999 !important; }
  .ot-informe .mantine-Text-root, .ot-informe .mantine-Title-root, .ot-informe td, .ot-informe th { color: #000 !important; }
  .ot-no-print { display: none !important; }
  .ot-solo-impresion { display: block !important; }
  .ot-tabla-impresion { display: table !important; }
  .ot-tarjetas-pantalla { display: none !important; }
  .ot-tabla-impresion { width: 100%; table-layout: fixed; }
  .ot-tabla-impresion th, .ot-tabla-impresion td { font-size: 9.5pt !important; padding: 4px 6px !important; overflow-wrap: anywhere; }
  .ot-tabla-impresion thead { display: table-header-group; }
  .ot-tabla-impresion tr { break-inside: avoid; page-break-inside: avoid; }
  .ot-bloque-final { break-inside: avoid; page-break-inside: avoid; }
  .ot-vistos-grid { display: grid !important; grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 8px !important; }
}`;
}
