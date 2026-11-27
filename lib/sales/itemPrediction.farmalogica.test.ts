import { beforeEach, describe, expect, it, vi } from 'vitest';
import { matchDescription, normalizeDescription, searchTokens } from './descriptionMatch';
import { parsePdfOrder } from './pdfOrder';

/**
 * Farmalogica PO 11619 (Inversiones en Salud del Valle, 2026-10-27): 3 lines with the customer's own code and a
 * long description, no EAN. The SAP data below mirrors FARMALOGICA on 2026-11-27 (SynerLink msg 41307).
 */
type RawItem = { ItemCode: string; ItemName: string; Frozen: string; SalesItem: string; ItemsGroupCode: number; QuantityOnStock: number };
const item = (ItemCode: string, ItemName: string, ItemsGroupCode: number, QuantityOnStock: number, frozen = false, sales = true): RawItem =>
  ({ ItemCode, ItemName, ItemsGroupCode, QuantityOnStock, Frozen: frozen ? 'tYES' : 'tNO', SalesItem: sales ? 'tYES' : 'tNO' });
const ITEMS: RawItem[] = [
  item('PTCZ012101', 'CEFAZOLINA 1g (1 UNID. X PLEGADIZA)', 133, 0),
  item('PTCZ0111', 'CEFAZOLINA 1g (10 UNID. X PLEGADIZA)', 133, 910),
  item('PTCZ0121', 'CEFAZOLINA 1g (10 UNID. X PLEGADIZA)', 133, 125460),
  item('PTCZ0111EXP', 'CEFAZOLINA 1g ECUADOR (10 UNID. X PLEGADIZA)', 133, 10020),
  item('PTCZ0111EXPP', 'CEFAZOLINA 1g ECUADOR PISA (10 UNID. X PLEGADIZA)', 133, 55),
  item('PTCZ0150', 'CEFAZOLINA 1g GUATEMALA (10 UNID. X PLEGADIZA)', 133, 0),
  item('PTCZ0152', 'CEFAZOLINA 1g HONDURAS (10 UNID. X PLEGADIZA)', 133, 1000),
  item('PTCZ0157', 'CEFAZOLINA 1g NICARAGUA (10 UNID. X PLEGADIZA)', 133, 0),
  item('PTCZ0155', 'CEFAZOLINA 1g PERÚ (10 UNID. X PLEGADIZA)', 133, 0),
  item('PTCZ0151', 'CEFAZOLINA 1g SALVADOR (10 UNID. X PLEGADIZA)', 133, 0),
  item('PTCZ0162', 'CEFAZOLINA 1g VENEZUELA  (10 UNID. X PLEGADIZA)', 133, 0),
  item('MPCE0105', 'CEFAZOLINA SODICA ESTERIL', 151, 643.158),
  item('MPCE010501', 'CEFAZOLINA SODICA ESTERIL (VITALIS)', 151, 0),
  item('PTZB0110A', 'ZOLIBIOS (CEFAZOLINA 1g BIOSELECT)(10 UND. X PLEGADIZA)', 100, 8895),
  item('PTZB0121', 'ZOLIBIOS 1g (CEFAZOLINA 1g BIOSELECT) (1 UNID X PLEGADIZA)', 133, 0),
  item('PTCZ1101', 'CEFAZOLINA 1g', 133, 0, true),
  item('MEET0030', 'ETIQUETA CEFAZOLINA 1 g', 111, 772500, false, false),
  item('PTPT0121', 'PIPERACILINA Y TAZOBACTAM 4.5g (10 UNID. X PLEGADIZA)', 139, 50000),
  item('PTSB0121', 'AMPICILINA Y SULBACTAM 1.5g (10 UNID. X PLEGADIZA)', 139, 40000),
];
const GROUPS = [
  { Number: 100, GroupName: 'Artículos' }, { Number: 111, GroupName: 'ETIQUETAS' }, { Number: 133, GroupName: 'PT Cefalosporinas' },
  { Number: 139, GroupName: 'PT Penicilinas' }, { Number: 151, GroupName: 'MP Cefalosporinas' }, { Number: 123, GroupName: 'PP Cefalosporinas' },
];
/** Customer invoices (last 12 months). */
const CUSTOMER_INVOICES: [string, string, string, number][] = [
  ['PTPT0121', 'PIPERACILINA Y TAZOBACTAM 4.5g (10 UNID. X PLEGADIZA)', '2026-10-07', 6300],
  ['PTSB0121', 'AMPICILINA Y SULBACTAM 1.5g (10 UNID. X PLEGADIZA)', '2026-10-07', 1800],
];
/** Company-wide invoices (any customer, last 6 months) of the description candidates. */
const COMPANY_INVOICES: [string, string, number][] = [
  ...Array.from({ length: 40 }, (_v, i) => ['PTCZ0121', '2026-11-20', [1500, 1600, 1490, 1900, 1650][i % 5]] as [string, string, number]),
  ['PTCZ0111EXP', '2026-09-10', 2100], ['PTCZ0111EXP', '2026-08-10', 2100],
  ['PTZB0110A', '2026-10-01', 2600], ['PTZB0110A', '2026-07-01', 2600],
];

const calls: string[] = [];
const quoted = (p: string) => [...p.matchAll(/'([^']*)'/g)].map((m) => m[1]);
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
vi.mock('../sap/serviceLayer', () => ({
  sapGet: async (_s: unknown, p: string) => {
    calls.push(p);
    const vals = quoted(p);
    if (p.startsWith('BarCodes?') || p.startsWith('AlternateCatNum?')) return { value: [] };
    if (p.startsWith('Items?') && p.includes('BarCode eq')) return { value: [] };
    if (p.startsWith('Items?')) return { value: ITEMS.filter((x) => vals.includes(x.ItemCode)) };
    throw new Error(`unexpected ${p}`);
  },
  sapGetAll: async (_s: unknown, p: string) => {
    calls.push(p);
    if (p.startsWith('ItemGroups?')) return GROUPS;
    if (p.startsWith('Items?') && p.includes('contains(ItemName')) {
      const terms = [...p.matchAll(/contains\(ItemName,'([^']*)'\)/g)].map((m) => m[1]);
      return ITEMS.filter((x) => x.Frozen === 'tNO' && x.SalesItem === 'tYES' && terms.some((t) => strip(x.ItemName).includes(t)));
    }
    if (p.startsWith('$crossjoin(Invoices') && p.includes("Invoices/CardCode eq '901714987'")) {
      return CUSTOMER_INVOICES.map(([ItemCode, ItemDescription, DocDate, UnitPrice], i) => ({
        Invoices: { DocEntry: 500 - i, DocDate }, 'Invoices/DocumentLines': { ItemCode, ItemDescription, UnitPrice },
      }));
    }
    if (p.startsWith('$crossjoin(Invoices')) {
      const codes = quoted(p);
      return COMPANY_INVOICES.filter(([c]) => codes.includes(c)).map(([ItemCode, DocDate, UnitPrice], i) => ({
        Invoices: { DocEntry: 90000 - i, DocDate }, 'Invoices/DocumentLines': { ItemCode, UnitPrice },
      }));
    }
    return [];
  },
}));

/** What the agent returns for PO 11619. */
const AGENT_JSON = JSON.stringify({
  numeroOrdenCompra: '11619', nitCliente: '901714987', fechaEntrega: '',
  lineas: [
    { codigoCliente: '9999990787', descripcion: 'PIPERACILINA 4G + TAZOBACTAM 0.5G POLVO PARA SOLUCION INYECTABLE VIAL 1 TABLETA (S) - LAB. :VARIOS', cantidad: 2000, precioUnitario: 6300 },
    { codigoCliente: '9999990210', descripcion: 'CEFAZOLINA 1G POLVO PARA SOLUCION INYECTABLE VIAL 1 TABLETA (S) - LAB. :VARIOS', cantidad: 6000, precioUnitario: 1450 },
    { codigoCliente: '9999990093', descripcion: 'AMPICILINA 1G + SULBACTAM 0.5G POLVO ESTERIL PARA RECONSTITUIR VIAL 1 TABLETA (S) - LAB. :VARIOS', cantidad: 6000, precioUnitario: 1800 },
  ],
});

describe('description normalization', () => {
  it('keeps only active ingredient and strength', () => {
    const n = normalizeDescription('CEFAZOLINA 1G POLVO PARA SOLUCION INYECTABLE VIAL 1 TABLETA (S) - LAB. :VARIOS');
    expect(n.components).toEqual([['cefazolina']]);
    expect(n.strengths).toEqual(['1000mg']);
    expect(n.forms).toContain('vial');
  });
  it('unifies units and splits combos', () => {
    const n = normalizeDescription('AMPICILINA 1 GR + SULBACTAM 0,5 g POLVO ESTERIL PARA RECONSTITUIR');
    expect(n.components).toEqual([['ampicilina'], ['sulbactam']]);
    expect(n.strengths).toEqual(['1000mg', '500mg']);
    expect(searchTokens(normalizeDescription('ACIDO ASCORBICO 500MG/5ML'))).toEqual(['ascorbico']);
    expect(normalizeDescription('ACIDO ASCORBICO 500MG/5ML AMP').strengths).toEqual(['500mg', '5ml']);
  });
  it('combo strength is the sum (4g + 0.5g = 4.5g); export variants and clashes are flagged', () => {
    const po = normalizeDescription('PIPERACILINA 4G + TAZOBACTAM 0.5G');
    expect(matchDescription(po, 'PIPERACILINA Y TAZOBACTAM 4.5g (10 UNID. X PLEGADIZA)')).toMatchObject({ ingredientOk: true, strengthOk: true });
    const cz = normalizeDescription('CEFAZOLINA 1G');
    expect(matchDescription(cz, 'CEFAZOLINA 1g PERÚ (10 UNID. X PLEGADIZA)', 'PTCZ0155').exportVariant).toBe(true);
    expect(matchDescription(cz, 'CEFAZOLINA 1g ECUADOR (10 UNID. X PLEGADIZA)', 'PTCZ0111EXP').exportVariant).toBe(true);
    expect(matchDescription(cz, 'CEFAZOLINA 2g').strengthClash).toBe(true);
    expect(matchDescription(cz, 'CEFALEXINA 1g').ingredientOk).toBe(false);
  });
});

describe('item prediction: Farmalogica PO 11619', () => {
  beforeEach(async () => {
    calls.length = 0;
    (await import('./itemResolver')).clearResolverCache();
  });

  it('cefazolina resolves to PTCZ0121 (not export, raw material or zero stock); lines 1 and 3 keep the customer history', async () => {
    const { resolveItems } = await import('./itemResolver');
    const r = parsePdfOrder(AGENT_JSON);
    expect(r.lineas).toHaveLength(3);
    const out = await resolveItems({ baseUrl: 'x', companyDB: 'FARMALOGICA' } as never, { cardCode: '901714987', input: r.lineas, today: '2026-11-27' });

    expect(out[0].prediction.candidates[0].ItemCode).toBe('PTPT0121');
    expect(out[0].prediction.confidence).toBe('media');
    expect(out[2].prediction.candidates[0].ItemCode).toBe('PTSB0121');
    expect(out[2].prediction.confidence).toBe('media');

    const cz = out[1].prediction;
    expect(cz.candidates[0].ItemCode).toBe('PTCZ0121');
    expect(['media', 'baja']).toContain(cz.confidence);
    expect(cz.autoSelected).toBe(false);
    expect(cz.candidates).toHaveLength(3);
    expect(cz.candidates[0].factor).toBe(1);
    expect(cz.candidates[0].reason).toMatch(/Coincide principio activo y concentración/);
    expect(cz.candidates[0].reason).toMatch(/Más vendido/);
    expect(cz.candidates[0].reason).toMatch(/Precio cercano/);
    const top3 = cz.candidates.map((c) => c.ItemCode);
    expect(top3).not.toContain('MPCE0105');
    expect(top3.some((c) => /EXP|0150|0151|0152|0155|0157|0162/.test(c))).toBe(false);

    // Bulk reads: one master query by ingredient, one company-sales read, two customer-history reads.
    expect(calls.filter((c) => c.includes('contains(ItemName'))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('$crossjoin'))).toHaveLength(3);
    const salesQ = calls.find((c) => c.startsWith('$crossjoin(Invoices') && !c.includes('CardCode'))!;
    expect(salesQ).toContain("Invoices/DocDate ge '2026-05-27'");
  });

  it('without any sales or price evidence the description still yields top-3 with confidence Baja', async () => {
    const { rankLine } = await import('./itemPrediction');
    const { toItemInfo } = await import('./itemResolver');
    const groups = new Set([151]);
    const items = new Map(ITEMS.map((x) => [x.ItemCode, toItemInfo(x, groups)]));
    const master = ITEMS.filter((x) => x.Frozen === 'tNO' && x.SalesItem === 'tYES' && x.ItemName.includes('CEFAZOLINA')).map((x) => x.ItemCode);
    const p = rankLine({ ItemDescription: 'CEFAZOLINA 1G POLVO PARA SOLUCION INYECTABLE VIAL', Quantity: 10, UnitPrice: null }, { barcode: [], catalog: [], master }, items, new Map());
    expect(p.confidence).toBe('baja');
    expect(p.candidates).toHaveLength(3);
    expect(p.candidates[0].ItemCode).toBe('PTCZ0121'); // in stock, domestic; PTCZ0111 has less stock but ties on the rest
    expect(p.reason).toMatch(/principio activo/);
  });

  it('only weak candidates (export, raw material, no stock) still return top-3 Baja, never empty', async () => {
    const { rankLine } = await import('./itemPrediction');
    const { toItemInfo } = await import('./itemResolver');
    const weak = ['PTCZ0155', 'PTCZ0157', 'MPCE0105'];
    const items = new Map(ITEMS.filter((x) => weak.includes(x.ItemCode)).map((x) => [x.ItemCode, toItemInfo(x, new Set([151]))]));
    const p = rankLine({ ItemDescription: 'CEFAZOLINA 2G VIAL', Quantity: 10, UnitPrice: null }, { barcode: [], catalog: [], master: weak }, items, new Map());
    expect(p.confidence).toBe('baja');
    expect(p.candidates.length).toBe(3);
  });
});
