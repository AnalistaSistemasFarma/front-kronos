import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/articles/access';
import { crearArticulo, itemExiste, sanitizeItem } from '../../../../lib/articles/articles';
import { registrarCambioArticulo } from '../../../../lib/articles/log';
import { REQUIRED_ON_CREATE } from '../../../../lib/articles/fields';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Cargue masivo de articulos en una empresa. Recibe filas ya mapeadas a campos
 * de Items (el cliente lee el Excel). Valida set minimo, duplicados internos y
 * contra SAP; crea fila por fila; devuelve el reporte { summary, ok, duplicated,
 * failed }. Todo server-side, una sola sesion SAP.
 */
const MAX_ROWS = 2000;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : [];

    if (!companyId) return NextResponse.json({ error: 'Falta companyId' }, { status: 400 });
    if (rows.length === 0) return NextResponse.json({ error: 'No hay filas para cargar' }, { status: 400 });
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Maximo ${MAX_ROWS} filas por carga` }, { status: 400 });
    }

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'write');
    if (!company || !company.endpoint) {
      return NextResponse.json(
        { error: 'No tiene permiso de escritura en esta empresa o no esta configurada' },
        { status: 403 }
      );
    }

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    const ok: { row: number; itemCode: string }[] = [];
    const duplicated: { row: number; itemCode: string; reason: string }[] = [];
    const failed: { row: number; itemCode: string; error: string }[] = [];
    const seen = new Set<string>();

    try {
      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2; // fila 1 = encabezado en el Excel
        const item = sanitizeItem(rows[i], company.companyName);
        const itemCode = item.ItemCode !== undefined ? String(item.ItemCode) : '';

        const faltantes = REQUIRED_ON_CREATE.filter((f) => item[f] === undefined || item[f] === '');
        if (faltantes.length > 0) {
          failed.push({ row: rowNum, itemCode, error: `Datos faltantes: ${faltantes.join(', ')}` });
          continue;
        }

        if (seen.has(itemCode)) {
          duplicated.push({ row: rowNum, itemCode, reason: 'Duplicado dentro del archivo' });
          continue;
        }

        try {
          if (await itemExiste(sap, itemCode)) {
            duplicated.push({ row: rowNum, itemCode, reason: 'Ya existe en SAP' });
            continue;
          }
          seen.add(itemCode);
          await crearArticulo(sap, item);
          await registrarCambioArticulo(sap, company.endpoint.logObject, {
            itemCode,
            action: 'crear',
            changes: item,
            userEmail: session.user.email,
          });
          ok.push({ row: rowNum, itemCode });
        } catch (err) {
          const msg = err instanceof SapError ? err.message : err instanceof Error ? err.message : 'Error';
          failed.push({ row: rowNum, itemCode, error: msg });
        }
      }
    } finally {
      await sapLogout(sap);
    }

    return NextResponse.json({
      summary: { total: rows.length, creados: ok.length, duplicados: duplicated.length, fallidos: failed.length },
      ok,
      duplicated,
      failed,
    });
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }
    console.error('Error en cargue masivo de articulos:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
