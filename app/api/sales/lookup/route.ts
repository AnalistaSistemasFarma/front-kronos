import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { odataString } from '../../../../lib/purchases/drafts';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Autocompletar de la oferta de venta contra SAP de la empresa.
 * GET ?companyId&kind=customer|item|warehouse|tax&q -> { options }. Minimo 2 caracteres.
 */
type Kind = 'customer' | 'item' | 'warehouse' | 'tax';
const KINDS: Kind[] = ['customer', 'item', 'warehouse', 'tax'];
const s = (v: unknown) => (v == null ? '' : String(v));

function path(kind: Kind, q: string) {
  const t = odataString(q.trim());
  switch (kind) {
    case 'customer':
      return `BusinessPartners?$top=10&$select=CardCode,CardName&$filter=(startswith(CardCode,${t}) or contains(CardName,${t})) and CardType eq 'cCustomer' and Frozen eq 'tNO'`;
    case 'item':
      return `Items?$top=10&$select=ItemCode,ItemName,DefaultWarehouse&$filter=(contains(ItemCode,${t}) or contains(ItemName,${t})) and SalesItem eq 'tYES' and Frozen eq 'tNO'`;
    case 'warehouse':
      return `Warehouses?$top=10&$select=WarehouseCode,WarehouseName&$filter=startswith(WarehouseCode,${t}) or contains(WarehouseName,${t})`;
    case 'tax':
      return `SalesTaxCodes?$top=10&$select=Code,Name&$filter=contains(Code,${t}) and Inactive eq 'tNO'`;
  }
}

function options(kind: Kind, rows: Record<string, unknown>[]) {
  switch (kind) {
    case 'customer':
      return rows.map((r) => ({ value: s(r.CardCode), label: `${s(r.CardCode)} · ${s(r.CardName)}`, fill: { CardName: s(r.CardName) } }));
    case 'item':
      return rows.map((r) => ({
        value: s(r.ItemCode),
        label: `${s(r.ItemCode)} · ${s(r.ItemName)}`,
        fill: { ItemDescription: s(r.ItemName), ...(r.DefaultWarehouse ? { WarehouseCode: s(r.DefaultWarehouse) } : {}) },
      }));
    case 'warehouse':
      return rows.map((r) => ({ value: s(r.WarehouseCode), label: `${s(r.WarehouseCode)} · ${s(r.WarehouseName)}` }));
    case 'tax':
      return rows.map((r) => ({ value: s(r.Code), label: `${s(r.Code)} · ${s(r.Name)}` }));
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    const kind = sp.get('kind') as Kind;
    const q = (sp.get('q') ?? '').slice(0, 60);
    if (!companyId || !KINDS.includes(kind)) return NextResponse.json({ error: 'Falta companyId o kind válido' }, { status: 400 });
    if (q.trim().length < 2) return NextResponse.json({ options: [] });
    const a = await salesEndpointForUser(session.user.email, companyId);
    if (!a?.endpoint) return NextResponse.json({ error: 'Sin acceso a ventas en esta empresa' }, { status: 403 });
    const sap = await sapLogin(a.endpoint);
    try {
      const data = await sapGet<{ value?: Record<string, unknown>[] }>(sap, path(kind, q));
      return NextResponse.json({ options: options(kind, data.value ?? []) }, { headers: { 'Cache-Control': 'no-store' } });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error en búsqueda de SAP para ventas:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
