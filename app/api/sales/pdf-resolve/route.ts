import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { salesCompanyConfig } from '../../../../lib/sales/companyConfig';
import { MAX_PDF_LINES, type ImportLine } from '../../../../lib/sales/linesImport';
import { validateLines } from '../../../../lib/sales/linesValidate';
import { bestCandidate, nitBase } from '../../../../lib/sales/pdfOrder';
import { CONFIDENCE_LABEL, convertLine, preferPriceList } from '../../../../lib/sales/itemPrediction';
import { resolveItems } from '../../../../lib/sales/itemResolver';
import { recentItems, RECENT_LINES, searchPath } from '../../../../lib/sales/search';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Monta la oferta desde lo que la IA del navegador leyó del PDF de la OC (solo datos extraídos; el PDF no llega
 * al servidor):
 *  1) identifica el CLIENTE en SAP por el NIT (CardCode o FederalTaxID) — o usa el que ya eligió el usuario;
 *  2) valida las líneas. Empresas de productos: predicción del artículo en el servidor (código de SAP, código de
 *     barras, catálogo del cliente, historial de pedidos y facturas del cliente, descripción), con hasta 3
 *     candidatos y nivel de confianza; solo la confianza alta queda elegida sin confirmar (2026-11-27).
 *     Empresas de servicios: emparejamiento por descripción (como antes).
 * POST { companyId, nit?, cardCode?, lines } -> { customer, customerCandidates, lines, avisos }
 */
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const received = Array.isArray(body.lines) ? body.lines.length : 0;
    const input = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_PDF_LINES) as ImportLine[];
    // Never drop lines silently: the user is told how many were left out.
    const avisoTope = received > MAX_PDF_LINES ? [`La orden trae ${received} líneas; se montan las primeras ${MAX_PDF_LINES}. Agregue las demás a mano o en otra oferta.`] : [];
    if (!companyId || !input.length) return NextResponse.json({ error: 'Faltan datos de la orden de compra.' }, { status: 400 });
    const access = await salesEndpointForUser(session.user.email, companyId, 'write');
    if (!access?.endpoint) return NextResponse.json({ error: 'Sin permiso para crear ofertas en esta empresa.' }, { status: 403 });
    const conf = await salesCompanyConfig(companyId);

    const sap = await sapLogin(access.endpoint);
    try {
      // 1) Cliente.
      let customer: { CardCode: string; CardName: string } | null = null;
      let customerCandidates: { CardCode: string; CardName: string }[] = [];
      const given = String(body.cardCode ?? '').trim().slice(0, 50);
      if (given) {
        const bp = await sapGet<{ CardCode: string; CardName: string }>(sap, `BusinessPartners(${q(given)})?$select=CardCode,CardName`).catch(() => null);
        if (bp) customer = { CardCode: bp.CardCode, CardName: bp.CardName };
      }
      const base = nitBase(String(body.nit ?? ''));
      if (!customer && base.length >= 6) {
        const r = await sapGet<{ value?: { CardCode: string; CardName: string; FederalTaxID?: string }[] }>(
          sap,
          `BusinessPartners?$select=CardCode,CardName,FederalTaxID&$filter=CardType eq 'cCustomer' and Valid eq 'tYES' and (contains(CardCode,${q(base)}) or contains(FederalTaxID,${q(base)}))&$top=5`,
          { Prefer: 'odata.maxpagesize=5' }
        );
        customerCandidates = (r.value ?? []).map((x) => ({ CardCode: x.CardCode, CardName: x.CardName }));
        const exact = customerCandidates.filter((x, i) => nitBase(x.CardCode) === base || nitBase(String(r.value?.[i]?.FederalTaxID ?? '')) === base);
        if (exact.length === 1) customer = exact[0];
        else if (customerCandidates.length === 1) customer = customerCandidates[0];
      }
      if (!customer) {
        return NextResponse.json({
          customer: null, customerCandidates, lines: [],
          avisos: [base ? `No se identificó un único cliente con el NIT ${body.nit} del PDF: elíjalo y vuelva a cargar el PDF.` : 'El PDF no trae NIT legible: elija el cliente y vuelva a cargar el PDF.'],
        });
      }

      // 2) Líneas. Every company: item prediction (code, barcode, catalog, customer history, description).
      // Companies with editable descriptions (Kelab, Meditrack, also OLP) get, for the lines the prediction could not
      // match, the previous description/coverage matching (free-text service lines keep the PDF description).
      const servicios = Boolean(conf?.descripcionEditable);
      const predicted = await predictLines(sap, {
        cardCode: customer.CardCode, input, priceListDefault: conf?.priceListDefault ?? null, defaultWarehouse: conf?.defaultWarehouse ?? null,
      });
      const confidenceOf = (l: Record<string, unknown>) => (l.match as { confidence: string } | undefined)?.confidence;
      const avisos: string[] = [...avisoTope];
      const legacyInput = servicios ? input.filter((_l, i) => confidenceOf(predicted[i]) === 'ninguna') : [];
      let lines: Record<string, unknown>[] = predicted;
      if (legacyInput.length) {
        const legacy = await legacyMatch(sap, { cardCode: customer.CardCode, input: legacyInput, servicios, priceListDefault: conf?.priceListDefault ?? null, defaultWarehouse: conf?.defaultWarehouse ?? null });
        const done = new Set(legacy.lines.map((l) => Number(l.row)));
        lines = [...predicted.filter((l) => !done.has(Number(l.row))), ...legacy.lines];
        avisos.push(...legacy.avisos);
      }
      // Mismo orden del PDF, de arriba abajo.
      lines.sort((x, y) => Number(x.row ?? 0) - Number(y.row ?? 0));
      const n = (c: string) => lines.filter((l) => confidenceOf(l) === c).length;
      const porConfirmar = n('media') + n('baja');
      if (porConfirmar) avisos.push(`${porConfirmar} línea(s) por confirmar: revise el artículo sugerido antes de agregarlas.`);
      if (n('ninguna')) avisos.push(`${n('ninguna')} línea(s) sin artículo en SAP: búsquelo o desmárquelas.`);
      return NextResponse.json({ customer, customerCandidates, lines, avisos });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error montando la oferta desde el PDF:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type Validated = Record<string, unknown>;

/**
 * Predicts the SAP item of each PO line and validates the top candidates (price list, warehouse) in ONE
 * validateLines call. Each line goes out with its best candidate and a «match» object for the UI.
 */
async function predictLines(
  sap: Awaited<ReturnType<typeof sapLogin>>,
  a: { cardCode: string; input: ImportLine[]; priceListDefault: number | null; defaultWarehouse: string | null }
): Promise<Validated[]> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const resolved = await resolveItems(sap, { cardCode: a.cardCode, input: a.input, today });
  // One pseudo-line per (line, candidate), with the box → unit conversion of that candidate.
  const pseudo: ImportLine[] = [];
  const key: { line: number; cand: number }[] = [];
  resolved.forEach((r, i) => r.prediction.candidates.forEach((c, j) => {
    const conv = convertLine(Number(r.input.Quantity), r.input.UnitPrice, c.factor);
    key.push({ line: i, cand: j });
    pseudo.push({ row: key.length, ItemCode: c.ItemCode, Quantity: conv.Quantity, UnitPrice: conv.UnitPrice, WarehouseCode: r.input.WarehouseCode ?? '', ItemDescription: '' });
  }));
  const v = pseudo.length
    ? await validateLines(sap, { cardCode: a.cardCode, input: pseudo, matchByDescription: false, priceListDefault: a.priceListDefault, defaultWarehouse: a.defaultWarehouse })
    : { lines: [] as Validated[] };
  const validated = new Map<string, Validated>();
  for (const l of v.lines) {
    const k = key[Number(l.row) - 1];
    if (k) validated.set(`${k.line}|${k.cand}`, l);
  }
  return resolved.map((r, i) => {
    const p = r.prediction;
    const candidates = preferPriceList(p.candidates
      .map((c, j) => ({ ...c, line: validated.get(`${i}|${j}`) }))
      .filter((c): c is typeof c & { line: Validated } => Boolean(c.line))
      .map((c) => ({ ...c, line: { ...c.line, row: r.input.row } })));
    const confidence = candidates.length ? p.confidence : 'ninguna';
    const match = {
      confidence, reason: candidates.length ? candidates[0].reason : p.reason,
      autoSelected: confidence === 'alta', confirmed: confidence === 'alta',
      source: { barcode: r.input.Barcode ?? '', clientCode: r.input.ClientCode ?? '', description: r.input.ItemDescription, quantity: r.input.Quantity, price: r.input.UnitPrice },
      candidates,
    };
    const best = candidates[0]?.line;
    const aiNote = best ? `${CONFIDENCE_LABEL[confidence]}: ${match.reason}` : null;
    if (best) return { ...best, aiNote, match };
    return {
      row: r.input.row, ItemCode: '', ItemDescription: r.input.ItemDescription || (r.input.Barcode ? `EAN ${r.input.Barcode}` : r.input.ClientCode ?? ''),
      Quantity: r.input.Quantity, ListPrice: 0, UnitPrice: r.input.UnitPrice ?? 0, WarehouseCode: '', aiNote: null, match,
    };
  });
}

/** Previous matching (description / coverage, customer's recent invoices as tie-break) for lines the prediction could not match. */
async function legacyMatch(
  sap: Awaited<ReturnType<typeof sapLogin>>,
  a: { cardCode: string; input: ImportLine[]; servicios: boolean; priceListDefault: number | null; defaultWarehouse: string | null }
): Promise<{ lines: Record<string, unknown>[]; avisos: string[] }> {
  // Artículos que ya se le han facturado a este cliente: desempatan el emparejamiento por descripción.
  const recientes = await sapGet<Record<string, unknown>>(sap, searchPath('recent_items', { cardCode: a.cardCode }), { Prefer: `odata.maxpagesize=${RECENT_LINES}` })
    .then((d) => recentItems(d, 60))
    .catch(() => []);
  const preferidos = new Map(recientes.map((r) => [r.ItemCode, r.Times]));
  const v = await validateLines(sap, {
    cardCode: a.cardCode, input: a.input, matchByDescription: true, servicios: a.servicios,
    priceListDefault: a.priceListDefault, defaultWarehouse: a.defaultWarehouse,
  });
  const avisos: string[] = v.errors.map((e) => e.error);
  const lines: Record<string, unknown>[] = v.lines.map((l) => ({ ...l, aiNote: null as string | null }));
  const elegidos: (ImportLine & { aiNote: string })[] = [];
  for (const p of v.pending) {
    // Los artículos que ya se le venden al cliente entran como candidatos aunque la búsqueda no los trajera.
    const extra = recientes.filter((r) => !p.candidates.some((c) => c.ItemCode === r.ItemCode)).map((r) => ({ ItemCode: r.ItemCode, ItemName: r.ItemName }));
    const b = bestCandidate(p.input.ItemDescription, a.servicios ? [...p.candidates, ...extra] : p.candidates, { servicios: a.servicios, preferidos });
    if (!b) {
      avisos.push(`«${p.input.ItemDescription}» (${p.input.Quantity}): no se encontró en SAP; agréguelo a mano.`);
      continue;
    }
    const otros = p.candidates.filter((c) => c.ItemCode !== b.ItemCode).slice(0, 3).map((c) => c.ItemCode).join(', ');
    elegidos.push({
      ...p.input, ItemCode: b.ItemCode,
      aiNote: b.seguro
        ? `Emparejado por descripción con «${b.ItemName}»`
        : `Revisar: se emparejó con «${b.ItemCode} ${b.ItemName}»${otros ? ` (otros posibles: ${otros})` : ''}`,
    });
  }
  if (elegidos.length) {
    const v2 = await validateLines(sap, {
      cardCode: a.cardCode, input: elegidos, matchByDescription: false, descripcionEditable: a.servicios,
      priceListDefault: a.priceListDefault, defaultWarehouse: a.defaultWarehouse,
    });
    v2.lines.forEach((l) => lines.push({ ...l, aiNote: elegidos.find((e) => e.row === l.row)?.aiNote ?? null }));
    avisos.push(...v2.errors.map((e) => e.error));
  }
  return { lines, avisos };
}
