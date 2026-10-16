import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '@/lib/mssqlPool';
import { listOrionDocumentViewerCompanies } from '@/lib/orion/documentAccess';
import { reindexAllOrionDocuments } from '@/lib/orion/documentIndex';
import { isMissingTableError } from '@/lib/orion/documentEvents';
import { resolveOrionActorUserId } from '@/lib/orion/service';

const MAX_PAGE_SIZE = 100;

function isAdminRole(role?: string | null): boolean {
  return role === 'admin' || role === 'superadmin';
}

/**
 * GET /api/integrations/orion/documents
 * Filtros: company, department, name (archivo o asunto), status, reviewStatus, from, to, page, pageSize.
 * Solo empresas donde el usuario tiene "Documentos firmados" (admin: todas).
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const isAdmin = isAdminRole(session.user?.role);

    const { searchParams } = new URL(req.url);
    const company = Number(searchParams.get('company'));
    const department = String(searchParams.get('department') || '').trim();
    const name = String(searchParams.get('name') || '').trim().slice(0, 200);
    const status = String(searchParams.get('status') || '').trim().toUpperCase();
    const reviewStatus = String(searchParams.get('reviewStatus') || '').trim().toUpperCase();
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get('pageSize')) || 25));

    const payload = await withMssqlPool(async (pool) => {
      let allowedCompanies: number[] | null = null;
      if (!isAdmin) {
        const actorId = await resolveOrionActorUserId(pool, {
          userId: session.user?.id ? String(session.user.id) : null,
          email,
        });
        allowedCompanies = actorId ? await listOrionDocumentViewerCompanies(pool, actorId) : [];
        if (allowedCompanies.length === 0) {
          throw Object.assign(
            new Error('No tiene el permiso “Documentos firmados” en ninguna empresa.'),
            { status: 403 }
          );
        }
      }

      const request = pool.request();
      const where: string[] = ['1 = 1'];
      if (allowedCompanies) {
        const names = allowedCompanies.map((id, i) => {
          request.input(`c${i}`, sql.Int, id);
          return `@c${i}`;
        });
        where.push(`odi.id_company IN (${names.join(', ')})`);
      }
      if (Number.isInteger(company) && company > 0) {
        request.input('company', sql.Int, company);
        where.push('odi.id_company = @company');
      }
      if (department) {
        request.input('department', sql.NVarChar(400), department);
        where.push('odi.department_name = @department');
      }
      if (name) {
        request.input('name', sql.NVarChar(210), `%${name.replace(/[%_[]/g, '[$&]')}%`);
        where.push('(odi.file_name LIKE @name OR odi.subject_request LIKE @name)');
      }
      if (status) {
        request.input('status', sql.NVarChar(40), status);
        where.push('odi.status = @status');
      }
      if (reviewStatus) {
        request.input('reviewStatus', sql.NVarChar(40), reviewStatus);
        where.push('odi.review_status = @reviewStatus');
      }
      if (from) {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) {
          request.input('from', sql.DateTime2, d);
          where.push('odi.updated_at >= @from');
        }
      }
      if (to) {
        const d = new Date(`${to}T23:59:59`);
        if (!Number.isNaN(d.getTime())) {
          request.input('to', sql.DateTime2, d);
          where.push('odi.updated_at <= @to');
        }
      }
      request.input('offset', sql.Int, (page - 1) * pageSize);
      request.input('pageSize', sql.Int, pageSize);

      const whereSql = where.join(' AND ');
      const scopeSql = allowedCompanies
        ? `WHERE odi.id_company IN (${allowedCompanies.map((_, i) => `@c${i}`).join(', ')})`
        : '';

      const result = await request.query(`
        SELECT COUNT(1) AS total FROM orion_document_index odi WHERE ${whereSql};

        SELECT odi.id_request, odi.file_id, odi.file_name, odi.orion_document_id, odi.version_label,
               odi.status, odi.review_status, odi.id_company, odi.company_name, odi.department_name,
               odi.category_name, odi.process_name, odi.subject_request, odi.signed_at,
               odi.created_at, odi.updated_at
        FROM orion_document_index odi
        WHERE ${whereSql}
        ORDER BY odi.updated_at DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;

        SELECT DISTINCT odi.id_company, odi.company_name
        FROM orion_document_index odi ${scopeSql}
        ORDER BY odi.company_name;

        SELECT DISTINCT odi.department_name
        FROM orion_document_index odi
        ${scopeSql ? `${scopeSql} AND` : 'WHERE'} odi.department_name IS NOT NULL
        ORDER BY odi.department_name;
      `);

      const sets = result.recordsets as unknown as Array<Array<Record<string, unknown>>>;
      return {
        total: Number(sets[0]?.[0]?.total ?? 0),
        items: sets[1] ?? [],
        companies: (sets[2] ?? [])
          .filter((r) => r.id_company != null)
          .map((r) => ({ id: Number(r.id_company), name: String(r.company_name || `Empresa ${r.id_company}`) })),
        departments: (sets[3] ?? []).map((r) => String(r.department_name)),
      };
    });

    return NextResponse.json({ ...payload, page, pageSize, isAdmin });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json(
        { error: 'Falta aplicar la migración orion_document_lifecycle (tabla orion_document_index).' },
        { status: 503 }
      );
    }
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}

/** POST /api/integrations/orion/documents — reconstruye el índice (solo admin). */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!isAdminRole(session.user?.role)) {
      return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
    }
    const result = await withMssqlPool((pool) => reindexAllOrionDocuments(pool));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json(
        { error: 'Falta aplicar la migración orion_document_lifecycle (tabla orion_document_index).' },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
