import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '@/lib/mssqlPool';
import { resolveOrionTraceScope } from '@/lib/orion/traceAccess';

function positiveInt(value: string | null): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * GET /api/integrations/orion/trace/filters?company=&category=
 * Empresas permitidas, categorías de la empresa elegida y procesos de la categoría elegida.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const company = positiveInt(searchParams.get('company'));
    const category = positiveInt(searchParams.get('category'));

    const payload = await withMssqlPool(async (pool) => {
      const scope = await resolveOrionTraceScope(pool, {
        id: session.user?.id ? String(session.user.id) : null,
        email,
        role: session.user?.role,
      });

      const companyAllowed = company != null && scope.companies.some((c) => c.id === company);

      let categories: Array<{ id: number; name: string }> = [];
      if (companyAllowed) {
        const res = await pool
          .request()
          .input('company', sql.Int, company)
          .query(`
            SELECT DISTINCT cr.id, cr.category
            FROM company_category_request ccr
            INNER JOIN category_request cr ON cr.id = ccr.id_category_request
            WHERE ccr.id_company = @company
            ORDER BY cr.category
          `);
        categories = res.recordset.map((row) => ({
          id: Number(row.id),
          name: String(row.category || `Categoría ${row.id}`),
        }));
      }

      let processes: Array<{ id: number; name: string }> = [];
      if (category != null && categories.some((c) => c.id === category)) {
        const res = await pool
          .request()
          .input('category', sql.Int, category)
          .query(`
            SELECT pc.id, pc.process
            FROM process_category pc
            WHERE pc.id_category_request = @category
            ORDER BY pc.process
          `);
        processes = res.recordset.map((row) => ({
          id: Number(row.id),
          name: String(row.process || `Proceso ${row.id}`),
        }));
      }

      return {
        isAdmin: scope.isAdmin,
        companies: scope.companies.map(({ id, name }) => ({ id, name })),
        categories,
        processes,
      };
    });

    return NextResponse.json(payload);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
