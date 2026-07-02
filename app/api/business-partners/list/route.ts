import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  getBusinessPartnersAccess,
  isCompanyReady,
  type BusinessPartnersCompanyAccess,
} from '../../../../lib/business-partners/access';
import { sapGetAll, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';
import { STANDARD_FIELD_NAMES } from '../../../../lib/business-partners/fields';

/**
 * Listado CONSOLIDADO de socios de negocio (entidad BusinessPartners) de todas
 * las empresas a las que el usuario tiene acceso de lectura. Todo en el
 * servidor: el Login a SAP usa las credenciales de sap_endpoints y nunca salen
 * al navegador.
 *
 * Tolerancia a fallo parcial: si una base SAP esta caida o expira, las demas
 * empresas igual responden; los fallos se reportan en `errors`.
 */

interface PartnersFilters {
  cardCode?: string;
  cardName?: string;
}

interface ListRequestBody {
  filters?: PartnersFilters;
  /** Tope de filas por empresa (default 10000). */
  top?: number;
}

interface ConsolidatedPartner {
  companyId: number;
  companyName: string;
  [key: string]: unknown;
}

/** Escapa comillas simples para literales OData. */
function odataLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Construye el $filter de OData a partir de los filtros recibidos. */
function buildFilter(filters: PartnersFilters = {}): string {
  const clauses: string[] = [];
  if (filters.cardCode) clauses.push(`contains(CardCode,'${odataLiteral(filters.cardCode)}')`);
  if (filters.cardName) clauses.push(`contains(CardName,'${odataLiteral(filters.cardName)}')`);
  return clauses.join(' and ');
}

/** Consulta los BusinessPartners de una empresa y los devuelve etiquetados. */
async function fetchCompanyPartners(
  access: BusinessPartnersCompanyAccess,
  filterString: string,
  top: number
): Promise<ConsolidatedPartner[]> {
  const ep = access.endpoint!;
  const session = await sapLogin({
    baseUrl: ep.baseUrl,
    username: ep.username,
    password: ep.password,
    companyDB: ep.companyDB,
  });

  try {
    const select = STANDARD_FIELD_NAMES.join(',');

    const query = new URLSearchParams();
    if (filterString) query.set('$filter', filterString);
    query.set('$select', select);
    query.set('$orderby', 'CardCode');

    // SAP entrega de a 20 por pagina; sapGetAll sigue la paginacion (nextLink)
    // hasta traer todos los socios de la empresa, con `top` como tope de seguridad.
    const rows = await sapGetAll<Record<string, unknown>>(
      session,
      `BusinessPartners?${query.toString()}`,
      {
        pageSize: 500,
        cap: top,
      }
    );

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

    const access = await getBusinessPartnersAccess(session.user.email);
    const readable = access.filter((a) => a.canRead && isCompanyReady(a));

    if (readable.length === 0) {
      return NextResponse.json({ items: [], errors: [], companies: [] });
    }

    const settled = await Promise.allSettled(
      readable.map((a) => fetchCompanyPartners(a, filterString, top))
    );

    const items: ConsolidatedPartner[] = [];
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
      })),
    });
  } catch (error) {
    console.error('Error consolidando socios de negocio:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
