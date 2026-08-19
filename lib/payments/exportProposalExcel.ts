import ExcelJS from 'exceljs';
import { addDataSheet, downloadWorkbook } from '@/lib/dashboard/excel/excelHelpers';

/**
 * Forma mínima que necesita la exportación. Se define aquí (en vez de reusar el
 * `SupplierGroup` completo de `proposal.ts`) para desacoplarla del modelo del
 * cliente, que es un subconjunto estructural: cualquier objeto con estos campos
 * sirve, incluido el `SupplierGroup` completo.
 */
export interface ExportableInvoice {
  docNum: number;
  docDate: string;
  docDueDate: string;
  docTotal: number;
  paidToDate: number;
  pendingAmount: number;
  docCurrency: string;
}

export interface ExportableGroup {
  cardCode: string;
  cardName: string;
  country: string;
  hasBankData: boolean;
  invoices: ExportableInvoice[];
}

/**
 * Exportación a Excel de la propuesta de pagos del Asistente de Pagos — SOLO
 * LECTURA: toma los grupos de la pestaña activa (nacional o exterior) tal como
 * ya llegaron del `GET /api/payment-assistant/proposal` y arma un .xlsx a nivel
 * de factura (una fila por factura, con los datos del proveedor repetidos).
 *
 * Reutiliza los helpers de `lib/dashboard/excel` (ExcelJS + file-saver) para no
 * introducir dependencias nuevas y mantener el mismo estilo de encabezado.
 */

export type ProposalTab = 'nacional' | 'exterior';

/** Fila plana de la exportación (una por factura). */
export interface ProposalExcelRow {
  proveedor: string;
  codigo: string;
  pais: string;
  moneda: string;
  documento: number | string;
  fecha: string;
  vencimiento: string;
  total: number;
  pagado: number;
  pendiente: number;
  banco: string;
}

/** Recorta un ISO/fecha SAP a YYYY-MM-DD. Vacío si no hay fecha. */
function toYmd(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

/**
 * Aplana los grupos de una pestaña a filas a nivel de factura. Los datos del
 * proveedor (nombre, código, país, ¿tiene banco?) se repiten en cada factura.
 */
export function buildProposalRows(groups: ExportableGroup[]): ProposalExcelRow[] {
  const rows: ProposalExcelRow[] = [];
  for (const group of groups) {
    const invoices = group.invoices ?? [];
    for (const inv of invoices) {
      rows.push({
        proveedor: group.cardName || group.cardCode || '',
        codigo: group.cardCode || '',
        pais: group.country || '',
        moneda: inv.docCurrency || '',
        documento: inv.docNum ?? '',
        fecha: toYmd(inv.docDate),
        vencimiento: toYmd(inv.docDueDate),
        total: inv.docTotal ?? 0,
        pagado: inv.paidToDate ?? 0,
        pendiente: inv.pendingAmount ?? 0,
        banco: group.hasBankData ? 'Sí' : 'No',
      });
    }
  }
  return rows;
}

/** Normaliza un texto para usarlo en el nombre de archivo (slug ASCII). */
export function slugify(value: string): string {
  // Descompone (NFD) y descarta los diacríticos combinantes (U+0300–U+036F) por
  // código, sin regex de clase de caracteres combinantes.
  const stripped = Array.from(value.normalize('NFD'))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join('');
  return (
    stripped
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'empresa'
  );
}

/** Sello de fecha AAAAMMDD a partir de una fecha (por defecto, hoy en el cliente). */
export function stampDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Nombre de archivo: propuesta-pagos-<empresa>-<nacional|exterior>-<AAAAMMDD>.xlsx */
export function buildFilename(companyName: string, tab: ProposalTab, date: Date = new Date()): string {
  return `propuesta-pagos-${slugify(companyName)}-${tab}-${stampDate(date)}.xlsx`;
}

const COLUMNS = [
  { header: 'Proveedor', key: 'proveedor', width: 36 },
  { header: 'Código proveedor', key: 'codigo', width: 16 },
  { header: 'País', key: 'pais', width: 10 },
  { header: 'Moneda', key: 'moneda', width: 10 },
  { header: 'Documento', key: 'documento', width: 14 },
  { header: 'Fecha', key: 'fecha', width: 14 },
  { header: 'Vencimiento', key: 'vencimiento', width: 14 },
  { header: 'Total', key: 'total', width: 16 },
  { header: 'Pagado', key: 'pagado', width: 16 },
  { header: 'Pendiente', key: 'pendiente', width: 16 },
  { header: '¿Tiene datos bancarios?', key: 'banco', width: 20 },
] as const;

/**
 * Construye y descarga el .xlsx de la pestaña activa. Reutiliza `addDataSheet`
 * (encabezado con estilo, autofiltro, fila congelada) y `downloadWorkbook`.
 */
export async function exportProposalTabExcel(params: {
  groups: ExportableGroup[];
  companyName: string;
  tab: ProposalTab;
}): Promise<void> {
  const { groups, companyName, tab } = params;
  const rows = buildProposalRows(groups);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kronos — Asistente de Pagos';
  workbook.created = new Date();

  const sheetName = tab === 'nacional' ? 'Pagos nacionales' : 'Pagos al exterior';
  const sheet = addDataSheet(workbook, sheetName, [...COLUMNS], rows as unknown as Record<string, unknown>[]);

  // Formato numérico es-CO para los montos (columnas Total, Pagado, Pendiente).
  ['H', 'I', 'J'].forEach((col) => {
    sheet.getColumn(col).numFmt = '#,##0';
  });

  await downloadWorkbook(workbook, buildFilename(companyName, tab));
}
