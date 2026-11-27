import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertLine, normalizeBarcode, packFromName, priceFactor, rankLine, type HistoryInfo, type ItemInfo } from './itemPrediction';
import { parsePdfOrder } from './pdfOrder';

/**
 * Coopidrogas purchase order 7500347986-3 (2026-11-24, sanitized): 11 lines, all with EAN, only 6 with a
 * description and a customer reference. The SAP data below mirrors ONE LATAM PHARMA on 2026-11-27.
 */
type RawItem = { ItemCode: string; ItemName: string; Frozen: string; SalesItem: string; BarCode: string };
const item = (ItemCode: string, ItemName: string, BarCode: string, frozen = false): RawItem => ({ ItemCode, ItemName, BarCode, Frozen: frozen ? 'tYES' : 'tNO', SalesItem: 'tYES' });
const ITEMS: RawItem[] = [
  item('10959', 'ACIDO ASCORBICO 500MG/5ML AMP CAJA X 10', '7707234231363'),
  item('10037', 'ACIDO ASCORBICO 500MG/5ML AMP CAJA X 100', '7707234230519'),
  item('11032', 'BETAMETASONA FOSFATO+BETAMETASONA ACETATO 3MG/ML VIAL CAJA X 1', '7707234232926'),
  item('11036', 'DIPIRONA SODICA 1G/2ML S.I VIAL CAJA X 5', '7707234234807'),
  item('10016', 'DIPIRONA SODICA 1GR/2ML AMP CAJA X 100', '7707234230830'),
  item('10035', 'TRIAMCINOLONA ACETONIDO 50MG/5ML VIAL CAJA X 1', '7707234230670'),
  item('11143', 'TRIAMCINOLONA ACETONIDO 50MG/5ML VIAL INST CAJA X 1', '7707234230670'),
  item('10005', 'BETAMETASONA FOSFATO+BETAMETASONA ACETATO 3MG/ML VIAL CAJA X 25', '7707234230717', true),
  item('11117', 'BETAMETASONA FOSFATO+BETAMETASONA ACETATO 3MG/ML VIAL INST CAJA X 25', '7707234230717'),
  item('10014', 'DEXAMETASONA FOSFATO 4MG/1ML AMP CAJA X 100', '7707234230922', true),
  item('11123', 'DEXAMETASONA FOSFATO 4MG/1ML AMP INST CAJA X 100', '7707234230922'),
  item('11034', 'DEXAMETASONA FOSFATO 4MG/ML S.I VIAL CAJA X 10', '7707234231417'),
  item('10208', 'CLORURO DE SODIO CS 0.9% FRASCO 100ML CAJA X 50', '7501125132117'),
  item('10209', 'CLORURO DE SODIO CS 0.9% FRASCO 500ML CAJA X 24', '7501125132056'),
  item('10207', 'CLORURO DE SODIO CS 0.9% FRASCO 1000ML CAJA X 12', '7501125132063'),
  item('10234', 'METFORMINA 850MG TAB CAJA X 30', '7501125167232'),
  item('10377', 'METFORMINA 850MG TAB USO INST CAJA X 30', '7702418001084'),
  item('11033', 'CLINDAMICINA 600MG/4ML S.I VIAL CAJA X 2', '7707234237891'),
  item('11038', 'N-BUTIL BROMURO DE HIOSCINA 20MG/1ML AMP CAJA X 5', '7707234237624'),
  item('10030', 'N-BUTIL BROMURO DE HIOSCINA 20MG/1ML  AMP CAJA X 100', '7707234230281'),
];
/** Additional barcodes (OBCD). Metformin's PO EAN is only here. */
const EXTRA_BARCODES = [
  { ItemNo: '10234', Barcode: '7501125188039' }, { ItemNo: '10035', Barcode: '7707234230670' }, { ItemNo: '11143', Barcode: '7707234230670' },
  { ItemNo: '10005', Barcode: '7707234230717' }, { ItemNo: '11117', Barcode: '7707234230717' }, { ItemNo: '10014', Barcode: '7707234230922' },
  { ItemNo: '11123', Barcode: '7707234230922' }, { ItemNo: '11032', Barcode: '7707234232926' },
];
/** Customer invoices (last 12 months): unit prices per SAP unit. */
const INVOICE_LINES: [string, string, string, number][] = [
  ['10959', 'ACIDO ASCORBICO 500MG/5ML AMP CAJA X 10', '2026-11-26', 4606],
  ['11032', 'BETAMETASONA FOSFATO+BETAMETASONA ACETATO 3MG/ML VIAL CAJA X 1', '2026-11-26', 8930],
  ['11036', 'DIPIRONA SODICA 1G/2ML S.I VIAL CAJA X 5', '2026-11-26', 2272],
  ['10016', 'DIPIRONA SODICA 1GR/2ML AMP CAJA X 100', '2026-06-30', 1692],
  ['10035', 'TRIAMCINOLONA ACETONIDO 50MG/5ML VIAL CAJA X 1', '2026-08-18', 28000],
  ['10005', 'BETAMETASONA FOSFATO+BETAMETASONA ACETATO 3MG/ML VIAL CAJA X 25', '2026-06-17', 10558.08],
  ['10014', 'DEXAMETASONA FOSFATO 4MG/1ML AMP CAJA X 100', '2026-06-17', 1410],
  ['11034', 'DEXAMETASONA FOSFATO 4MG/ML S.I VIAL CAJA X 10', '2026-11-26', 1723],
  ['10208', 'CLORURO DE SODIO CS 0.9% FRASCO 100ML CAJA X 50', '2026-11-26', 2021],
  ['10209', 'CLORURO DE SODIO CS 0.9% FRASCO 500ML CAJA X 24', '2026-11-26', 2491],
  ['10207', 'CLORURO DE SODIO CS 0.9% FRASCO 1000ML CAJA X 12', '2026-11-26', 3901],
  ['10234', 'METFORMINA 850MG TAB CAJA X 30', '2026-11-26', 279],
  ['11033', 'CLINDAMICINA 600MG/4ML S.I VIAL CAJA X 2', '2026-11-26', 2977],
  ['11038', 'N-BUTIL BROMURO DE HIOSCINA 20MG/1ML AMP CAJA X 5', '2026-11-26', 2193],
  ['10030', 'N-BUTIL BROMURO DE HIOSCINA 20MG/1ML  AMP CAJA X 100', '2026-09-24', 2914],
];

const calls: string[] = [];
const quoted = (p: string) => [...p.matchAll(/'([^']*)'/g)].map((m) => m[1]);
vi.mock('../sap/serviceLayer', () => ({
  sapGet: async (_s: unknown, p: string) => {
    calls.push(p);
    const vals = quoted(p);
    if (p.startsWith('BarCodes?')) return { value: EXTRA_BARCODES.filter((b) => vals.includes(b.Barcode)) };
    if (p.startsWith('AlternateCatNum?')) return { value: [] };
    if (p.startsWith('Items?') && p.includes('contains(ItemName')) {
      const terms = [...p.matchAll(/contains\(ItemName,'([^']*)'\)/g)].map((m) => m[1]);
      return { value: ITEMS.filter((x) => x.Frozen === 'tNO' && terms.every((t) => x.ItemName.includes(t))).slice(0, 12) };
    }
    if (p.startsWith('Items?') && p.includes('BarCode eq')) return { value: ITEMS.filter((x) => vals.includes(x.BarCode)) };
    if (p.startsWith('Items?')) return { value: ITEMS.filter((x) => vals.includes(x.ItemCode)) };
    throw new Error(`unexpected ${p}`);
  },
  sapGetAll: async (_s: unknown, p: string) => {
    calls.push(p);
    if (!p.startsWith('$crossjoin(Invoices')) return [];
    return INVOICE_LINES.map(([ItemCode, ItemDescription, DocDate, UnitPrice], i) => ({
      Invoices: { DocEntry: 1000 - i, DocDate },
      'Invoices/DocumentLines': { ItemCode, ItemDescription, UnitPrice },
    }));
  },
}));

/** What the agent returns for the fixture with the new instruction (ean / codigoCliente / descripcion as written). */
function agentJsonFromFixture(): string {
  const text = readFileSync(path.join(__dirname, '__fixtures__', 'coopidrogas-oc.txt'), 'utf8');
  const lineas = text.split('\n').filter((r) => /^\d{13} \|/.test(r)).map((r) => {
    const cells = r.split('|').map((c) => c.trim());
    const ean = cells[0];
    const hasDesc = !cells[1].startsWith('Código Interno');
    const ref = (hasDesc ? cells[2] : cells[1]).replace(/^Código Interno \/ Referencia:\s*/, '');
    const rest = cells.slice(hasDesc ? 3 : 2);
    const money = (s: string) => Number(s.replace(/[$,]/g, ''));
    return { ean, codigoCliente: ref, codigo: '', descripcion: hasDesc ? cells[1] : '', cantidad: Number(rest[0]), precioUnitario: money(rest[3]) };
  });
  return JSON.stringify({ numeroOrdenCompra: '7500347986-3', nitCliente: '860026123', fechaEntrega: '', lineas });
}

const EXPECTED: [string, string, number][] = [
  // [EAN, item, factor]
  ['7707234231363', '10959', 10], ['7707234232926', '11032', 1], ['7707234234807', '11036', 5], ['7707234230670', '10035', 1],
  ['7707234230717', '11117', 25], ['7707234230922', '11123', 100], ['7501125132117', '10208', 1], ['7501125132056', '10209', 1],
  ['7501125188039', '10234', 30], ['7707234237891', '11033', 2], ['7707234237624', '11038', 5],
];

describe('item prediction: Coopidrogas PO 7500347986-3', () => {
  beforeEach(() => { calls.length = 0; });

  it('parses EAN and customer reference from the agent answer', () => {
    const r = parsePdfOrder(agentJsonFromFixture());
    expect(r.lineas).toHaveLength(11);
    expect(r.lineas[0]).toMatchObject({ ItemCode: '', Barcode: '7707234231363', ClientCode: '10959', Quantity: 21, UnitPrice: 46060 });
    expect(r.lineas[1]).toMatchObject({ Barcode: '7707234232926', ItemDescription: '', Quantity: 172 });
    expect(r.lineas[1].ClientCode).toBeUndefined();
  });

  it('maps 11 of 11 lines; 9 high confidence, the 2 whose old item is inactive need confirmation', async () => {
    const { resolveItems } = await import('./itemResolver');
    const r = parsePdfOrder(agentJsonFromFixture());
    const out = await resolveItems({} as never, { cardCode: '860026123', input: r.lineas, today: '2026-11-27' });
    expect(out).toHaveLength(11);
    out.forEach((o, i) => {
      const [ean, code, factor] = EXPECTED[i];
      expect(o.input.Barcode).toBe(ean);
      expect(o.prediction.candidates[0]?.ItemCode, ean).toBe(code);
      expect(o.prediction.candidates[0]?.factor, ean).toBe(factor);
    });
    const conf = out.map((o) => o.prediction.confidence);
    expect(conf.filter((c) => c === 'alta')).toHaveLength(9);
    expect(conf[4]).toBe('media');
    expect(conf[5]).toBe('media');
    expect(out[4].prediction.reason).toMatch(/compraba 10005 \(inactivo\)/);
    expect(out[0].prediction.reason).toMatch(/Coincide con el código de barras/);
    expect(out[8].prediction.reason).toMatch(/Precio por caja x 30/);
    // Bulk reads only: never one SAP call per line.
    expect(calls.filter((c) => c.startsWith('$crossjoin'))).toHaveLength(2);
    expect(calls.length).toBeLessThanOrEqual(8);
  });

  it('history filter is bounded by date (12 months)', async () => {
    const { resolveItems } = await import('./itemResolver');
    await resolveItems({} as never, { cardCode: '860026123', input: parsePdfOrder(agentJsonFromFixture()).lineas.slice(0, 1), today: '2026-11-27' });
    const h = calls.find((c) => c.startsWith('$crossjoin(Invoices'));
    expect(h).toContain("Invoices/DocDate ge '2025-11-27'");
    expect(h).toContain("Invoices/CardCode eq '860026123'");
  });
});

describe('item prediction: rules', () => {
  const items = new Map<string, ItemInfo>([
    ['A', { ItemCode: 'A', ItemName: 'ACETAMINOFEN 500MG TAB CAJA X 100', active: true, pack: 100 }],
    ['B', { ItemCode: 'B', ItemName: 'ACETAMINOFEN 500MG TAB CAJA X 10', active: true, pack: 10 }],
  ]);
  const hist = (code: string, price: number): HistoryInfo => ({ ItemCode: code, ItemName: items.get(code)!.ItemName, lastDate: '2026-10-12', lastPrice: price, times: 4, source: 'pedido' });

  it('history by description + price is high only when strict', () => {
    const p = rankLine({ ItemDescription: 'ACETAMINOFEN 500 MG TAB X 10', Quantity: 5, UnitPrice: 1000 }, { barcode: [], catalog: [], master: [] }, items, new Map([['B', hist('B', 100)]]));
    expect(p.candidates[0].ItemCode).toBe('B');
    expect(p.candidates[0].factor).toBe(10);
    expect(p.candidates[0].reason).toMatch(/Pedido anterior del cliente 2026-10-12/);
  });
  it('description only (no history, no barcode) is never auto-selected', () => {
    const p = rankLine({ ItemDescription: 'ACETAMINOFEN 500MG', Quantity: 5, UnitPrice: null }, { barcode: [], catalog: [], master: ['A', 'B'] }, items, new Map());
    expect(p.autoSelected).toBe(false);
    expect(['media', 'baja']).toContain(p.confidence);
  });
  it('nothing found', () => {
    const p = rankLine({ ItemDescription: '', Quantity: 1, UnitPrice: null }, { barcode: [], catalog: [], master: [] }, items, new Map());
    expect(p.confidence).toBe('ninguna');
    expect(p.candidates).toEqual([]);
  });
  it('helpers', () => {
    expect(normalizeBarcode('770-7234-23136-3')).toBe('7707234231363');
    expect(normalizeBarcode('10959')).toBe('');
    expect(packFromName('METFORMINA 850MG TAB CAJA X 30')).toBe(30);
    expect(priceFactor(8366, 279, 30)).toBe(30);
    expect(priceFactor(26320, 28000, 1)).toBe(1);
    expect(priceFactor(5000, 279, 30)).toBeNull();
    expect(convertLine(462, 8366, 30)).toEqual({ Quantity: 13860, UnitPrice: 278.8667 });
  });
});
