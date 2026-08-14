import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getAssignedSubprocessIdsForUser } from '../../../../lib/process/subprocessAssignments';
import { assertReadOnlyAgainstCatalog } from '../../../../lib/sql/readonly';
import { runReadOnlyQuery } from '../../../../lib/custom-views/roDb';

export const dynamic = 'force-dynamic';

const PREVIEW_ROW_LIMIT = 1000;
const CREATE_SUBPROCESS_NAME = 'Constructor de Vistas';

/**
 * ¿El usuario puede CREAR/previsualizar vistas? (permiso de creación, §7).
 * Admins siempre; o quien tenga asignado el subproceso "Constructor de Vistas".
 */
async function canCreateViews(userId: string, role: string | null): Promise<boolean> {
  if (role === 'admin') return true;
  const sub = await prisma.subprocess.findFirst({
    where: { subprocess: CREATE_SUBPROCESS_NAME },
    select: { id_subprocess: true },
  });
  if (!sub) return false;
  const assigned = await getAssignedSubprocessIdsForUser(userId);
  return assigned.includes(sub.id_subprocess);
}

/**
 * POST /api/custom-views/preview  { sql: string, companyId?: number }
 *
 * Valida el SQL con el candado de solo lectura + whitelist estricta del catálogo;
 * si pasa, lo ejecuta con el usuario READ-ONLY envuelto en
 *   SELECT TOP (1000) * FROM ( <sql> ) AS _q
 * (tope de filas + timeout). Devuelve { columns, rows, rowCount }. NO persiste nada.
 * Ver propuesta técnica §4.1 / §4.2 / §5.3.
 */
export async function POST(req: Request) {
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

    const allowed = await canCreateViews(user.id, user.role ?? null);
    if (!allowed) {
      return NextResponse.json(
        {
          error:
            'No tiene permiso para previsualizar vistas. Requiere el módulo "Constructor de Vistas".',
        },
        { status: 403 }
      );
    }

    let body: { sql?: unknown; companyId?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'JSON inválido en el cuerpo.' }, { status: 400 });
    }

    const rawSql = typeof body.sql === 'string' ? body.sql.trim() : '';
    const companyId =
      typeof body.companyId === 'number' && Number.isFinite(body.companyId)
        ? body.companyId
        : null;

    if (!rawSql) {
      return NextResponse.json(
        { error: 'Debe proporcionar una consulta SQL en el campo "sql".' },
        { status: 400 }
      );
    }

    // 1) Candado de solo lectura + whitelist estricta contra el catálogo.
    try {
      await assertReadOnlyAgainstCatalog(rawSql, prisma);
    } catch (validationError) {
      return NextResponse.json(
        {
          error: 'La consulta no pasó la validación de seguridad.',
          detail:
            validationError instanceof Error
              ? validationError.message
              : String(validationError),
        },
        { status: 400 }
      );
    }

    // 2) Ejecución acotada: tope de filas + timeout, con usuario READ-ONLY.
    // El preview del autor corre con visión completa (§5.3); companyId se echa
    // en la respuesta como metadato (la inyección por empresa aplica al publicar).
    const userSql = rawSql.replace(/;\s*$/, '');
    const wrapped = `SELECT TOP (${PREVIEW_ROW_LIMIT}) * FROM (\n${userSql}\n) AS _q`;

    try {
      const { columns, rows, rowCount } = await runReadOnlyQuery(wrapped);
      return NextResponse.json(
        {
          ok: true,
          columns,
          rows,
          rowCount,
          truncated: rowCount >= PREVIEW_ROW_LIMIT,
          companyId,
        },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    } catch (execError) {
      // Feedback claro con el mensaje del motor SQL.
      return NextResponse.json(
        {
          error: 'Error al ejecutar la consulta.',
          detail: execError instanceof Error ? execError.message : String(execError),
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Error en /api/custom-views/preview:', error);
    return NextResponse.json(
      { error: 'Error del servidor al procesar la vista previa.' },
      { status: 500 }
    );
  }
}
