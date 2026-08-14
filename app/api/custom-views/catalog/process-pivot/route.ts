import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '../../../../../lib/prisma';
import { canCreateViews, getUserCompanyIds } from '../../../../../lib/custom-views/access';
import { runReadOnlyQuery } from '../../../../../lib/custom-views/roDb';
import { buildPivotSql, type PivotFormField } from '../../../../../lib/custom-views/pivotBuilder';

export const dynamic = 'force-dynamic';

/**
 * GET /api/custom-views/catalog/process-pivot?processId=X
 *
 * Genera —EN EL SERVIDOR, a partir de process_form_field (no del input del
 * usuario)— el SQL de una vista pivoteada para el flujo X: una fila por solicitud
 * + los campos internos del formulario como columnas. Devuelve { sql }.
 *
 * Requiere el permiso de creación de vistas (§7) y valida que el flujo esté en el
 * alcance de empresa del usuario. Los campos se leen del MISMO motor read-only
 * (VIEWS_DATABASE_URL) donde se ejecutará el pivote (ids consistentes).
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }
    if (!(await canCreateViews(user.id, user.role ?? null))) {
      return NextResponse.json(
        {
          error:
            'No tiene permiso para el Constructor de Vistas. Requiere el módulo "Constructor de Vistas".',
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const raw = searchParams.get('processId');
    const processId = raw !== null ? Number(raw) : NaN;
    if (!Number.isInteger(processId) || processId <= 0) {
      return NextResponse.json(
        { error: 'Parámetro processId inválido: se requiere un id de flujo entero.' },
        { status: 400 }
      );
    }

    const isAdmin = user.role === 'admin';

    // Verifica que el flujo exista, esté activo y (si no es admin) en el alcance
    // de empresa del usuario. Trae también el nombre del flujo para el comentario.
    const flowRes = await runReadOnlyQuery(
      `
        SELECT pc.id AS id_process_category, pc.process, c.id_company
        FROM process_category pc
        INNER JOIN category_request cr ON cr.id = pc.id_category_request
        INNER JOIN company_category_request ccr ON ccr.id_category_request = cr.id
        INNER JOIN company c ON c.id_company = ccr.id_company
        WHERE pc.active = 1 AND pc.id = @processId
      `,
      { processId }
    );

    if (flowRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'El flujo de trabajo no existe o no está activo.' },
        { status: 404 }
      );
    }

    if (!isAdmin) {
      const allowed = new Set(await getUserCompanyIds(user.id));
      const inScope = flowRes.rows.some((r) =>
        allowed.has(Number((r as Record<string, unknown>).id_company))
      );
      if (!inScope) {
        return NextResponse.json(
          { error: 'El flujo de trabajo no está en su alcance de empresa.' },
          { status: 403 }
        );
      }
    }

    const processName = String(
      (flowRes.rows[0] as Record<string, unknown>).process ?? ''
    ).trim();

    // Campos del formulario del flujo (activos, en orden).
    const fieldsRes = await runReadOnlyQuery(
      `
        SELECT id, field_label, field_type, display_order
        FROM process_form_field
        WHERE active = 1 AND id_process_category = @processId
        ORDER BY display_order, id
      `,
      { processId }
    );

    const fields: PivotFormField[] = (fieldsRes.rows as Array<Record<string, unknown>>).map(
      (r) => ({
        id: Number(r.id),
        field_label: String(r.field_label ?? ''),
        field_type: String(r.field_type ?? ''),
        display_order:
          r.display_order === null || r.display_order === undefined
            ? null
            : Number(r.display_order),
      })
    );

    const sql = buildPivotSql({ processId, fields, processName });

    return NextResponse.json(
      { sql, processId, processName, fieldCount: fields.length },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error en /api/custom-views/catalog/process-pivot:', error);
    return NextResponse.json(
      { error: 'Error al generar el SQL del flujo de trabajo.' },
      { status: 500 }
    );
  }
}
