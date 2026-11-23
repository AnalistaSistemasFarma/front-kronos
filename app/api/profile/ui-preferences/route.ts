import sql from 'mssql';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import sqlConfig from '../../../../dbconfig.js';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { isAllowedPrefKey, normalizePrefValue, parsePrefValue } from '../../../../lib/ui/preferences';

/**
 * Preferencias de interfaz del usuario de la sesión (colores de compañía, anchos de columnas).
 * GET -> { prefs: { clave: valor } } · PUT { key, value } -> { ok }
 * Si la tabla aún no existe (falta el script), GET devuelve vacío y PUT 503: la pantalla sigue funcionando.
 */
async function userId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  return u?.id ?? null;
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const pool = await sql.connect(sqlConfig);
    const r = await pool.request().input('u', sql.NVarChar(255), id)
      .query(`SELECT pref_key, pref_value FROM dbo.user_ui_preference WHERE id_user = @u;`);
    const prefs: Record<string, unknown> = {};
    for (const row of r.recordset) prefs[row.pref_key] = parsePrefValue(row.pref_key, row.pref_value);
    return NextResponse.json({ prefs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Preferencias de interfaz (GET):', error);
    return NextResponse.json({ prefs: {} });
  }
}

export async function PUT(request: NextRequest) {
  const id = await userId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const key = String(body.key ?? '');
  if (!isAllowedPrefKey(key)) return NextResponse.json({ error: 'Preferencia no válida' }, { status: 400 });
  const value = normalizePrefValue(key, body.value);
  if (value == null) return NextResponse.json({ error: 'Valor no válido' }, { status: 400 });
  try {
    const pool = await sql.connect(sqlConfig);
    await pool.request().input('u', sql.NVarChar(255), id).input('k', sql.NVarChar(100), key).input('v', sql.NVarChar(4000), value)
      .query(`MERGE dbo.user_ui_preference AS t
              USING (SELECT @u AS id_user, @k AS pref_key) AS s ON t.id_user = s.id_user AND t.pref_key = s.pref_key
              WHEN MATCHED THEN UPDATE SET pref_value = @v, updated_at = sysutcdatetime()
              WHEN NOT MATCHED THEN INSERT (id_user, pref_key, pref_value) VALUES (@u, @k, @v);`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Preferencias de interfaz (PUT):', error);
    return NextResponse.json({ error: 'No se pudo guardar la preferencia' }, { status: 503 });
  }
}
