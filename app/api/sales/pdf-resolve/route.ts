import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { salesCompanyConfig } from '../../../../lib/sales/companyConfig';
import { MAX_IMPORT_LINES, type ImportLine } from '../../../../lib/sales/linesImport';
import { validateLines } from '../../../../lib/sales/linesValidate';
import { bestCandidate, nitBase } from '../../../../lib/sales/pdfOrder';
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
    const input = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_IMPORT_LINES) as ImportLine[];
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

      // 2) Líneas.
      const v = await validateLines(sap, {
        cardCode: customer.CardCode, input, matchByDescription: true,
        priceListDefault: conf?.priceListDefault ?? null, defaultWarehouse: conf?.defaultWarehouse ?? null,
      });
      const avisos: string[] = v.errors.map((e) => e.error);
      const lines: Record<string, unknown>[] = v.lines.map((l) => ({ ...l, aiNote: null as string | null }));
      const elegidos: (ImportLine & { aiNote: string })[] = [];
      for (const p of v.pending) {
        const b = bestCandidate(p.input.ItemDescription, p.candidates);
        if (!b) {
          avisos.push(`«${p.input.ItemDescription}» (${p.input.Quantity}): no se encontró en SAP; agréguelo a mano.`);
          continue;
        }
        elegidos.push({ ...p.input, ItemCode: b.ItemCode, aiNote: b.seguro ? `Emparejado por descripción con «${b.ItemName}»` : `Revisar: «${p.input.ItemDescription}» se emparejó con «${b.ItemName}» (hay otros parecidos)` });
      }
      if (elegidos.length) {
        const v2 = await validateLines(sap, {
          cardCode: customer.CardCode, input: elegidos, matchByDescription: false,
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
