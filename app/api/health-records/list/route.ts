import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  getHealthRecordsAccess,
  isCompanyReady,
  type HealthRecordsCompanyAccess,
} from '../../../../lib/health-records/access';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Listado CONSOLIDADO de registros sanitarios de todas las empresas a las que
 * el usuario tiene acceso de lectura. Todo ocurre en el servidor: el Login a SAP
 * usa las credenciales de sap_endpoints y nunca salen al navegador.
 *
 * Tolerancia a fallo parcial: si una base SAP esta caida o expira, las demas
 * empresas igual responden; los fallos se reportan en `errors`.
 */

interface HealthRecordsFilters {
  registroSanitario?: string;
  referencia?: string;
  descripcion?: string;
  pais?: string;
  titular?: string;
  vencimientoDesde?: string; // YYYY-MM-DD
  vencimientoHasta?: string; // YYYY-MM-DD
}

interface ListRequestBody {
  filters?: HealthRecordsFilters;
  /** Tope de filas por empresa (default 200). */
  top?: number;
}

interface ConsolidatedRecord {
  companyId: number;
  companyName: string;
  [key: string]: unknown;
}

/** Escapa comillas simples para literales OData. */
function odataLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Construye el $filter de OData a partir de los filtros recibidos. */
function buildFilter(filters: HealthRecordsFilters = {}): string {
  const clauses: string[] = [];

  if (filters.registroSanitario) {
    clauses.push(`U_Registro_Sanitario eq '${odataLiteral(filters.registroSanitario)}'`);
  }
  if (filters.referencia) {
    clauses.push(`contains(U_Referencia,'${odataLiteral(filters.referencia)}')`);
  }
  if (filters.descripcion) {
    clauses.push(`contains(U_Descripcion,'${odataLiteral(filters.descripcion)}')`);
  }
  if (filters.pais) {
    clauses.push(`contains(U_Pais,'${odataLiteral(filters.pais)}')`);
  }
  if (filters.titular) {
    clauses.push(`U_Titular eq '${odataLiteral(filters.titular)}'`);
  }
  if (filters.vencimientoDesde) {
    clauses.push(`U_Fecha_Vencimiento ge '${odataLiteral(filters.vencimientoDesde)}'`);
  }
  if (filters.vencimientoHasta) {
    clauses.push(`U_Fecha_Vencimiento le '${odataLiteral(filters.vencimientoHasta)}'`);
  }

  return clauses.join(' and ');
}

/** Consulta el UDO de una empresa y devuelve sus registros etiquetados. */
async function fetchCompanyRecords(
  access: HealthRecordsCompanyAccess,
  filterString: string,
  top: number
): Promise<ConsolidatedRecord[]> {
  const ep = access.endpoint!;
  const session = await sapLogin({
    baseUrl: ep.baseUrl,
    username: ep.username,
    password: ep.password,
    companyDB: ep.companyDB,
  });

  try {
    const query = new URLSearchParams();
    if (filterString) query.set('$filter', filterString);
    query.set('$orderby', 'DocNum desc');
    query.set('$top', String(top));

    const data = await sapGet<{ value?: Record<string, unknown>[] }>(
      session,
      `${ep.healthRecordsEntity}?${query.toString()}`
    );

    return (data.value ?? []).map((row) => ({
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
    const top = Math.min(Math.max(body.top ?? 200, 1), 1000);
    const filterString = buildFilter(body.filters);

    const access = await getHealthRecordsAccess(session.user.email);
    const readable = access.filter((a) => a.canRead && isCompanyReady(a));

    if (readable.length === 0) {
      return NextResponse.json({ items: [], errors: [], companies: [] });
    }

    const settled = await Promise.allSettled(
      readable.map((a) => fetchCompanyRecords(a, filterString, top))
    );

    const items: ConsolidatedRecord[] = [];
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
    console.error('Error consolidando registros sanitarios:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
