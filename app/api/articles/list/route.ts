import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  getArticlesAccess,
  isCompanyReady,
  type ArticlesCompanyAccess,
} from '../../../../lib/articles/access';
import { sapGetAll, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';
import { STANDARD_FIELD_NAMES, getCompanyCustomFields } from '../../../../lib/articles/fields';

/**
 * Listado CONSOLIDADO de articulos (entidad Items) de todas las empresas a las
 * que el usuario tiene acceso de lectura. Todo en el servidor: el Login a SAP
 * usa las credenciales de sap_endpoints y nunca salen al navegador.
 *
 * Tolerancia a fallo parcial: si una base SAP esta caida o expira, las demas
 * empresas igual responden; los fallos se reportan en `errors`.
 */

interface ArticlesFilters {
  itemCode?: string;
  itemName?: string;
}

interface ListRequestBody {
  filters?: ArticlesFilters;
  /** Tope de filas por empresa (default 200). */
  top?: number;
}

interface ConsolidatedItem {
  companyId: number;
  companyName: string;
  [key: string]: unknown;
}

/** Escapa comillas simples para literales OData. */
function odataLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Construye el $filter de OData a partir de los filtros recibidos. */
function buildFilter(filters: ArticlesFilters = {}): string {
  const clauses: string[] = [];
  if (filters.itemCode) clauses.push(`contains(ItemCode,'${odataLiteral(filters.itemCode)}')`);
  if (filters.itemName) clauses.push(`contains(ItemName,'${odataLiteral(filters.itemName)}')`);
  return clauses.join(' and ');
}

/** Consulta los Items de una empresa y los devuelve etiquetados. */
async function fetchCompanyItems(
  access: ArticlesCompanyAccess,
  filterString: string,
  top: number
): Promise<ConsolidatedItem[]> {
  const ep = access.endpoint!;
  const session = await sapLogin({
    baseUrl: ep.baseUrl,
    username: ep.username,
    password: ep.password,
    companyDB: ep.companyDB,
  });

  try {
    // $select = campos estandar gestionados + custom de ESA empresa.
    const customFields = getCompanyCustomFields(access.companyName).map((c) => c.field);
    const select = [...STANDARD_FIELD_NAMES, ...customFields].join(',');

    const query = new URLSearchParams();
    if (filterString) query.set('$filter', filterString);
    query.set('$select', select);
    query.set('$orderby', 'ItemCode');

    // SAP entrega de a 20 por pagina; sapGetAll sigue la paginacion (nextLink)
    // hasta traer todos los Items de la empresa, con `top` como tope de seguridad.
    const rows = await sapGetAll<Record<string, unknown>>(session, `Items?${query.toString()}`, {
      pageSize: 500,
      cap: top,
    });

    return rows.map((row) => ({
      ...row,
      companyId: access.idCompany,
      companyName: access.companyName,
    }));
  } finally {
    await sapLogout(session);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: ListRequestBody = await request.json().catch(() => ({}));
    const top = Math.min(Math.max(body.top ?? 10000, 1), 20000);
    const filterString = buildFilter(body.filters);

    const access = await getArticlesAccess(session.user.email);
    const readable = access.filter((a) => a.canRead && isCompanyReady(a));

    if (readable.length === 0) {
      return NextResponse.json({ items: [], errors: [], companies: [] });
    }

    const settled = await Promise.allSettled(
      readable.map((a) => fetchCompanyItems(a, filterString, top))
    );

    const items: ConsolidatedItem[] = [];
    const errors: { companyId: number; companyName: string; message: string }[] = [];

    settled.forEach((result, i) => {
      const company = readable[i];
      if (result.status === 'fulfilled') {
        items.push(...result.value);
      } else {
        const reason = result.reason;
        const message =
          reason instanceof SapError
            ? reason.message
            : reason instanceof Error
              ? reason.message
              : 'Error desconocido al consultar SAP';
        errors.push({
          companyId: company.idCompany,
          companyName: company.companyName,
          message,
        });
      }
    });

    return NextResponse.json({
      items,
      errors,
      companies: readable.map((a) => ({
        idCompany: a.idCompany,
        companyName: a.companyName,
        canWrite: a.canWrite,
      })),
    });
  } catch (error) {
    console.error('Error consolidando articulos:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
