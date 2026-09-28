import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { searchOrionDocuments } from '@/lib/orion/client';
import { resolveOrionTraceScope } from '@/lib/orion/traceAccess';

const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];
const ALLOWED_STATUSES = new Set([
  'BORRADOR',
  'PENDIENTE_FIRMA',
  'EN_PROCESO',
  'FIRMADO',
  'RECHAZADO',
  'DEVUELTO',
]);

function positiveInt(value: string | null): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isoOrNull(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * GET /api/integrations/orion/trace
 * Proxy de GET /documents/search en Orion, limitado a las empresas con
 * "Ver trazabilidad de documentos" (admin: todas las del mapa de tenants).
 * Filtros: company, category, process, q, status (coma), signerEmail, from, to, page, pageSize.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const scope = await withMssqlPool((pool) =>
      resolveOrionTraceScope(pool, {
        id: session.user?.id ? String(session.user.id) : null,
        email,
        role: session.user?.role,
      })
    );

    const { searchParams } = new URL(req.url);
    const requestedCompany = positiveInt(searchParams.get('company'));
    let company: number | null = null;
    if (requestedCompany) {
      if (!scope.companies.some((c) => c.id === requestedCompany)) {
        return NextResponse.json(
          { error: 'No tiene permiso de trazabilidad en esa empresa.' },
          { status: 403 }
        );
      }
      company = requestedCompany;
    } else if (!scope.isAdmin) {
      // Orion filtra por una sola empresa; sin selección se usa la primera permitida.
      company = scope.companies[0]?.id ?? null;
    }

    const status = String(searchParams.get('status') || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => ALLOWED_STATUSES.has(s))
      .join(',');
    const requestedSize = Number(searchParams.get('pageSize'));
    const pageSize = ALLOWED_PAGE_SIZES.includes(requestedSize) ? requestedSize : 25;
    const page = positiveInt(searchParams.get('page')) ?? 1;
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const result = await searchOrionDocuments({
      synerlinkCompanyId: company,
      synerlinkCategoryId: positiveInt(searchParams.get('category')),
      synerlinkProcessId: positiveInt(searchParams.get('process')),
      synerlinkRequestId: positiveInt(searchParams.get('requestId')),
      q: String(searchParams.get('q') || '').trim().slice(0, 200),
      status,
      signerEmail: String(searchParams.get('signerEmail') || '').trim().toLowerCase(),
      createdFrom: isoOrNull(from),
      createdTo: to ? isoOrNull(`${to}T23:59:59`) : null,
      page,
      pageSize,
    });

    if (!result.ok || !result.data) {
      const upstream = result.status >= 400 && result.status < 500 ? result.status : 502;
      return NextResponse.json(
        { error: result.error || 'Orion no respondió la búsqueda', code: result.code },
        { status: upstream }
      );
    }

    return NextResponse.json({ ...result.data, company, isAdmin: scope.isAdmin });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
