import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { salesCompanyConfig } from '../../../../lib/sales/companyConfig';
import { MAX_PDF_LINES, type ImportLine } from '../../../../lib/sales/linesImport';
import { validateLines } from '../../../../lib/sales/linesValidate';
import { bestCandidate, nitBase } from '../../../../lib/sales/pdfOrder';
import { recentItems, RECENT_LINES, searchPath } from '../../../../lib/sales/search';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Monta la oferta desde lo que la IA del navegador leyó del PDF de la OC (solo datos extraídos; el PDF no llega
 * al servidor):
 *  1) identifica el CLIENTE en SAP por el NIT (CardCode o FederalTaxID) — o usa el que ya eligió el usuario;
 *  2) valida las líneas; las que no traen código de SAP se emparejan por descripción y se toma el artículo
 *     más parecido (marcado «a revisar» si no es claro).
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

      // 2) Líneas. Empresas de servicios (descripción editable: Kelab, Meditrack): la OC trae descripciones libres
      // y SAP tiene pocos artículos genéricos; se empareja por cobertura y la línea conserva la descripción del PDF.
      const servicios = Boolean(conf?.descripcionEditable);
      // Artículos que ya se le han facturado a este cliente: desempatan el emparejamiento por descripción.
      const recientes = await sapGet<Record<string, unknown>>(sap, searchPath('recent_items', { cardCode: customer.CardCode }), { Prefer: `odata.maxpagesize=${RECENT_LINES}` })
        .then((d) => recentItems(d, 60))
        .catch(() => []);
      const preferidos = new Map(recientes.map((r) => [r.ItemCode, r.Times]));
      const v = await validateLines(sap, {
        cardCode: customer.CardCode, input, matchByDescription: true, servicios,
        priceListDefault: conf?.priceListDefault ?? null, defaultWarehouse: conf?.defaultWarehouse ?? null,
      });
      const avisos: string[] = [...avisoTope, ...v.errors.map((e) => e.error)];
      const lines: Record<string, unknown>[] = v.lines.map((l) => ({ ...l, aiNote: null as string | null }));
      const elegidos: (ImportLine & { aiNote: string })[] = [];
      for (const p of v.pending) {
        // Los artículos que ya se le venden al cliente entran como candidatos aunque la búsqueda no los trajera.
        const extra = recientes.filter((r) => !p.candidates.some((c) => c.ItemCode === r.ItemCode)).map((r) => ({ ItemCode: r.ItemCode, ItemName: r.ItemName }));
        const b = bestCandidate(p.input.ItemDescription, servicios ? [...p.candidates, ...extra] : p.candidates, { servicios, preferidos });
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
          cardCode: customer.CardCode, input: elegidos, matchByDescription: false, descripcionEditable: servicios,
          priceListDefault: conf?.priceListDefault ?? null, defaultWarehouse: conf?.defaultWarehouse ?? null,
        });
        v2.lines.forEach((l) => lines.push({ ...l, aiNote: elegidos.find((e) => e.row === l.row)?.aiNote ?? null }));
        avisos.push(...v2.errors.map((e) => e.error));
      }
      // Mismo orden del PDF, de arriba abajo (las emparejadas por descripción se validan aparte y quedaban al final).
      lines.sort((x, y) => Number(x.row ?? 0) - Number(y.row ?? 0));
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
