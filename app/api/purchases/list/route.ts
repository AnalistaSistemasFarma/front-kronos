import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  getPurchasesAccess,
  isCompanyReady,
  type PurchasesCompanyAccess,
} from '../../../../lib/purchases/access';
import { sapGetAll, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';
import {
  DOC_OBJECT_CODE,
  LIST_SELECT,
  type PurchaseTipo,
} from '../../../../lib/purchases/fields';

/**
 * Listado CONSOLIDADO de Solicitudes u Ordenes de compra (entidad Drafts) de
 * todas las empresas a las que el usuario tiene acceso de lectura. Todo en el
 * servidor: el Login a SAP usa las credenciales de sap_endpoints y nunca salen
 * al navegador.
 *
 * Tolerancia a fallo parcial: si una base SAP esta caida o expira, las demas
 * empresas igual responden; los fallos se reportan en `errors`.
 *
 * CAVEAT: los Drafts son PESADOS (~50k chars c/u) -> SIEMPRE $select acotado.
 * SAP pagina de a 20 -> sapGetAll sigue la paginacion (nextLink).
 */

interface PurchaseFilters {
  /** Filtra por estado U_SEND_State (B, ENC, LA, A, NAD). */
  state?: string;
  /** Filtra por dependencia U_SEND_Dep. */
  dep?: string;
}

interface ListRequestBody {
  /** Tipo de documento: 'solicitudes' (oPurchaseRequest) u 'ordenes' (oPurchaseOrders). */
  tipo?: PurchaseTipo;
  filters?: PurchaseFilters;
  /** Tope de filas por empresa (default 10000). */
  top?: number;
}

interface ConsolidatedDraft {
  companyId: number;
  companyName: string;
  [key: string]: unknown;
}

/** Escapa comillas simples para literales OData. */
function odataLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Construye el $filter de OData: DocObjectCode (obligatorio) + filtros opcionales. */
function buildFilter(tipo: PurchaseTipo, filters: PurchaseFilters = {}): string {
  const clauses: string[] = [`DocObjectCode eq '${DOC_OBJECT_CODE[tipo]}'`];
  if (filters.state) clauses.push(`U_SEND_State eq '${odataLiteral(filters.state)}'`);
  if (filters.dep) clauses.push(`U_SEND_Dep eq '${odataLiteral(filters.dep)}'`);
  return clauses.join(' and ');
}

/** Consulta los Drafts de compras de una empresa y los devuelve etiquetados. */
async function fetchCompanyDrafts(
  access: PurchasesCompanyAccess,
  filterString: string,
  top: number
): Promise<ConsolidatedDraft[]> {
  const ep = access.endpoint!;
  const session = await sapLogin({
    baseUrl: ep.baseUrl,
    username: ep.username,
    password: ep.password,
    companyDB: ep.companyDB,
  });

  try {
    const query = new URLSearchParams();
    query.set('$filter', filterString);
    query.set('$select', LIST_SELECT);
    query.set('$orderby', 'DocEntry desc');

    // SAP entrega de a 20 por pagina; sapGetAll sigue la paginacion (nextLink)
    // hasta traer todos los Drafts del tipo, con `top` como tope de seguridad.
    const rows = await sapGetAll<Record<string, unknown>>(session, `Drafts?${query.toString()}`, {
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
    const tipo: PurchaseTipo = body.tipo === 'ordenes' ? 'ordenes' : 'solicitudes';
    const top = Math.min(Math.max(body.top ?? 10000, 1), 20000);
    const filterString = buildFilter(tipo, body.filters);

    const access = await getPurchasesAccess(session.user.email);
    const readable = access.filter((a) => a.canRead && isCompanyReady(a));

    if (readable.length === 0) {
      return NextResponse.json({ items: [], errors: [], companies: [] });
    }

    const settled = await Promise.allSettled(
      readable.map((a) => fetchCompanyDrafts(a, filterString, top))
    );

    const items: ConsolidatedDraft[] = [];
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
    console.error('Error consolidando compras:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
