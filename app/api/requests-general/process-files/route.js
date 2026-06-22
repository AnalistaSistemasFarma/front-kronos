import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const idProcess = searchParams.get('id_process');

    if (!idProcess) {
      return NextResponse.json(
        { error: 'Se requiere el parámetro id_process' },
        { status: 400 }
      );
    }

    const query = `
      SELECT
        fpc.id,
        fpc.file_label,
        fpc.required,
        fpc.display_order,
        fpc.id_condition_option
      FROM file_process_category fpc
      WHERE fpc.active = 1 AND fpc.id_process_category = @idProcess
      ORDER BY fpc.display_order, fpc.id
    `;

    const request = pool.request();
    request.input('idProcess', sql.Int, parseInt(idProcess));

    const result = await request.query(query);

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error en process-files:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
