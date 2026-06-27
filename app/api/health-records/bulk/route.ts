import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../lib/health-records/access';
import { crearRegistro, registroExiste, sanitizeRecord } from '../../../../lib/health-records/records';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Cargue masivo de registros sanitarios en una empresa. Recibe filas ya
 * mapeadas a campos U_* (el cliente lee el Excel). Valida obligatorios,
 * duplicados internos y contra SAP; crea fila por fila con su log; devuelve el
 * reporte { ok, duplicated, failed }. Todo server-side, una sola sesion SAP.
 */

const REQUIRED = ['U_Referencia', 'U_Descripcion', 'U_Registro_Sanitario'] as const;
const MAX_ROWS = 2000;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userName = session.user.name || session.user.email;

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
    const entity = company.endpoint.healthRecordsEntity!;

    const sap = await sapLogin({
      baseUrl: company.endpoint.baseUrl,
      username: company.endpoint.username,
      password: company.endpoint.password,
      companyDB: company.endpoint.companyDB,
    });

    const ok: { row: number; registro: string; docNum: number }[] = [];
    const duplicated: { row: number; registro: string; reason: string }[] = [];
    const failed: { row: number; registro: string; error: string }[] = [];
    const seen = new Set<string>();

    try {
      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2; // fila 1 = encabezado en el Excel
        const record = sanitizeRecord(rows[i]);
        const registro = record.U_Registro_Sanitario ?? '';

        const faltantes = REQUIRED.filter((f) => !record[f]);
        if (faltantes.length > 0) {
          failed.push({ row: rowNum, registro, error: `Datos faltantes: ${faltantes.join(', ')}` });
          continue;
        }

        if (seen.has(registro)) {
          duplicated.push({ row: rowNum, registro, reason: 'Duplicado dentro del archivo' });
          continue;
        }

        try {
          if (await registroExiste(sap, entity, registro)) {
            duplicated.push({ row: rowNum, registro, reason: 'Ya existe en SAP' });
            continue;
          }
          seen.add(registro);
          const docNum = await crearRegistro(sap, company.endpoint, record, userName, 'Creado por cargue masivo');
          ok.push({ row: rowNum, registro, docNum });
        } catch (err) {
          const msg = err instanceof SapError ? err.message : err instanceof Error ? err.message : 'Error';
          failed.push({ row: rowNum, registro, error: msg });
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
    console.error('Error en cargue masivo de registros sanitarios:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
