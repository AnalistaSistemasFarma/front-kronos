import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { salesCompanyConfig } from '../../../../lib/sales/companyConfig';
import { MAX_IMPORT_LINES, type ImportLine } from '../../../../lib/sales/linesImport';
import { customerPriceList, pickPrice } from '../../../../lib/sales/pricing';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Valida contra SAP las líneas leídas de un Excel (cargue de líneas de la oferta):
 *  - el artículo existe, está activo y es de venta;
 *  - la bodega (si viene) existe; si no viene, la bodega por defecto del artículo;
 *  - precio de lista SIEMPRE de SAP (precio especial o lista del cliente / por defecto de la empresa). El precio
 *    del Excel, si viene, es el precio de venta propuesto; si no, se usa el de lista (o 0 si no hay, como SAPSEND).
 * POST { companyId, cardCode, lines: ImportLine[] } -> { lines: [...válidas], errors: [{ row, error }] }
 */
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const CHUNK = 25;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const cardCode = String(body.cardCode ?? '').trim().slice(0, 50);
    const input = (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_IMPORT_LINES) as ImportLine[];
    if (!companyId || !cardCode) return NextResponse.json({ error: 'Elija primero el cliente.' }, { status: 400 });
    if (!input.length) return NextResponse.json({ error: 'El archivo no tiene líneas.' }, { status: 400 });
    const access = await salesEndpointForUser(session.user.email, companyId, 'write');
    if (!access?.endpoint) return NextResponse.json({ error: 'Sin permiso para crear ofertas en esta empresa.' }, { status: 403 });
    const conf = await salesCompanyConfig(companyId);

    const sap = await sapLogin(access.endpoint);
    try {
      const bpList = await customerPriceList(sap, cardCode);
      const codes = [...new Set(input.map((l) => String(l.ItemCode)))];
      const items = new Map<string, Record<string, unknown>>();
      const special = new Map<string, number>();
      for (let i = 0; i < codes.length; i += CHUNK) {
        const part = codes.slice(i, i + CHUNK);
        const or = part.map((c) => `ItemCode eq ${q(c)}`).join(' or ');
        const r = await sapGet<{ value?: Record<string, unknown>[] }>(sap, `Items?$select=ItemCode,ItemName,Frozen,SalesItem,DefaultWarehouse,ItemPrices&$filter=${or}`, { Prefer: `odata.maxpagesize=${CHUNK}` });
        for (const it of r.value ?? []) items.set(String(it.ItemCode), it);
        const s = await sapGet<{ value?: { ItemCode: string; Price: number }[] }>(sap, `SpecialPrices?$select=ItemCode,Price&$filter=CardCode eq ${q(cardCode)} and (${or})`, { Prefer: `odata.maxpagesize=${CHUNK}` }).catch(() => ({ value: [] }));
        for (const x of s.value ?? []) special.set(String(x.ItemCode), Number(x.Price));
      }
      const whs = [...new Set(input.map((l) => String(l.WarehouseCode ?? '').trim()).filter(Boolean))];
      const okWh = new Set<string>();
      for (let i = 0; i < whs.length; i += CHUNK) {
        const or = whs.slice(i, i + CHUNK).map((w) => `WarehouseCode eq ${q(w)}`).join(' or ');
        const r = await sapGet<{ value?: { WarehouseCode: string }[] }>(sap, `Warehouses?$select=WarehouseCode&$filter=${or}`, { Prefer: `odata.maxpagesize=${CHUNK}` });
        for (const w of r.value ?? []) okWh.add(String(w.WarehouseCode));
      }

      const lines: Record<string, unknown>[] = [];
      const errors: { row: number; error: string }[] = [];
      for (const l of input) {
        const it = items.get(String(l.ItemCode));
        if (!it) { errors.push({ row: l.row, error: `${l.ItemCode}: el artículo no existe en SAP.` }); continue; }
        if (it.Frozen === 'tYES' || it.SalesItem !== 'tYES') { errors.push({ row: l.row, error: `${l.ItemCode}: el artículo está inactivo o no es de venta.` }); continue; }
        const wh = String(l.WarehouseCode ?? '').trim() || String(it.DefaultWarehouse ?? '');
        if (l.WarehouseCode && !okWh.has(String(l.WarehouseCode).trim())) { errors.push({ row: l.row, error: `${l.ItemCode}: la bodega ${l.WarehouseCode} no existe en SAP.` }); continue; }
        const lp = special.has(String(l.ItemCode))
          ? { price: special.get(String(l.ItemCode)) ?? null }
          : pickPrice(it.ItemPrices as { PriceList: number; Price: number }[] | undefined, bpList, conf?.priceListDefault ?? null);
        const listPrice = lp.price ?? 0;
        lines.push({
          ItemCode: String(it.ItemCode),
          ItemDescription: conf?.descripcionEditable && l.ItemDescription ? l.ItemDescription : String(it.ItemName ?? ''),
          Quantity: Number(l.Quantity),
          ListPrice: listPrice,
          UnitPrice: l.UnitPrice != null ? Number(l.UnitPrice) : listPrice,
          WarehouseCode: wh,
        });
      }
      return NextResponse.json({ lines, errors });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error validando las líneas del Excel:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
