import { prisma } from '../../../../../lib/prisma';
import { asignarArticuloSap } from '../../../../../lib/biomedica/inventario';
import { escapeOData } from '../../../../../lib/health-records/records';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../../lib/sap/serviceLayer';
import { errorResponse, jsonNoStore, readJson } from '../../../sgc/_lib/context';
import { biomedContext } from '../../_acceso';

export const dynamic = 'force-dynamic';

/**
 * ARTÍCULO DE SAP OPCIONAL del equipo (la bomba aún no está codificada en el SAP de OLP; cuando lo esté, se
 * asigna en bloque).
 * GET ?company=&q= — busca artículos en el SAP de la empresa (solo lectura, máx. 15).
 * POST { company, ids, itemCode | null, itemName? } — lo asigna (o lo quita) a los equipos elegidos.
 */
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const c = await biomedContext(request, p.get('company'));
    if (c instanceof Response) return c;
    const q = (p.get('q') ?? '').trim().slice(0, 60);
    if (q.length < 2) return jsonNoStore({ items: [] });
    const ep = await prisma.sap_endpoints.findFirst({ where: { id_company: c.access.idCompany }, orderBy: [{ is_active: 'desc' }, { id_sap_endpoint: 'asc' }] });
    if (!ep?.base_url || !ep.client) return jsonNoStore({ error: 'La empresa no tiene SAP configurado.' }, 409);
    const sap = await sapLogin({ baseUrl: ep.base_url, username: ep.username ?? '', password: ep.password ?? '', companyDB: ep.client });
    try {
      const e = escapeOData(q);
      const filter = encodeURIComponent(`(contains(ItemName,'${e}') or contains(ItemCode,'${e}')) and Frozen eq 'tNO'`);
      const data = await sapGet<{ value?: { ItemCode: string; ItemName: string }[] }>(sap, `Items?$filter=${filter}&$select=ItemCode,ItemName&$top=15`);
      return jsonNoStore({ items: (data.value ?? []).map((it) => ({ itemCode: it.ItemCode, itemName: it.ItemName })) });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return jsonNoStore({ error: error.message }, error.status);
    return errorResponse(error, 'biomedica:inventario:sap');
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!body) return jsonNoStore({ error: 'Petición inválida' }, 400);
    const c = await biomedContext(request, body.company);
    if (c instanceof Response) return c;
    return jsonNoStore(await asignarArticuloSap(prisma, c.access, body, c.actor));
  } catch (error) {
    return errorResponse(error, 'biomedica:inventario:sap:asignar');
  }
}
