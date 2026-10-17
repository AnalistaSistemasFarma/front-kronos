import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { canViewLoginAudit } from '../../../../lib/auth/login-audit/access';
import { LOGIN_AUDIT_LIMITS } from '../../../../lib/auth/login-audit/constants';
import { parseLoginAuditFilters } from '../../../../lib/auth/login-audit/filters';
import { listLoginAuditCountries, queryLoginAudit } from '../../../../lib/auth/login-audit/query';
import { authOptions } from '../../auth/[...nextauth]/route';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/users/login-audit — auditoría de inicios de sesión (SOLO LECTURA).
 *   ?user=&from=YYYY-MM-DD&to=YYYY-MM-DD&country=CO|INTERNA|DESCONOCIDO&result=ok|fallo
 *   &provider=&alerts=1&page=&limit=
 *   &export=1 → hasta 10.000 filas para Excel (sin paginar).
 * Reja: lib/auth/login-audit/access.ts (admin de Usuarios + rol admin o marcador).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers: NO_STORE });
    }
    if (!(await canViewLoginAudit(session.user.email))) {
      return NextResponse.json(
        { error: 'No tiene permiso para ver la auditoría de inicios de sesión' },
        { status: 403, headers: NO_STORE }
      );
    }

    const params = new URL(request.url).searchParams;
    const filters = parseLoginAuditFilters(params);
    const isExport = params.get('export') === '1';

    const [page, countries] = await Promise.all([
      isExport
        ? queryLoginAudit(filters, { limit: LOGIN_AUDIT_LIMITS.maxExportRows, offset: 0 })
        : queryLoginAudit(filters),
      isExport ? Promise.resolve([]) : listLoginAuditCountries(filters),
    ]);

    return NextResponse.json(
      {
        ...page,
        countries,
        truncated: isExport && page.summary.total > LOGIN_AUDIT_LIMITS.maxExportRows,
        range: { from: filters.from.toISOString(), to: filters.to.toISOString() },
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[login-audit] Error al consultar:', message);
    // Si el script SQL aún no se corrió en esta base, se dice claro en vez de un 500 mudo.
    if (/user_login_audit/i.test(message) && /invalid object name|no es válido|nombre de objeto/i.test(message)) {
      return NextResponse.json(
        { error: 'La tabla de auditoría de inicios de sesión aún no existe en esta base (falta el script SQL del pase).' },
        { status: 503, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { error: 'No se pudo consultar la auditoría de inicios de sesión' },
      { status: 500, headers: NO_STORE }
    );
  }
}
