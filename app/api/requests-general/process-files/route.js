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

    const result = await pool
      .request()
      .input('idProcess', sql.Int, parseInt(idProcess))
      .query(`
        SELECT
          fpc.id,
          fpc.file_label,
          fpc.required,
          fpc.display_order
        FROM file_process_category fpc
        WHERE fpc.active = 1 AND fpc.id_process_category = @idProcess
        ORDER BY fpc.display_order, fpc.id
      `);

    const files = result.recordset;

    if (files.length === 0) {
      return NextResponse.json([], { status: 200 });
    }

    // Condiciones (M:N) de los archivos de este proceso
    const condResult = await pool
      .request()
      .input('idProcess', sql.Int, parseInt(idProcess))
      .query(`
        SELECT fco.id_file_process_category AS id_file, fco.id_option
        FROM file_condition_option fco
        INNER JOIN file_process_category fpc ON fpc.id = fco.id_file_process_category
        WHERE fpc.active = 1 AND fpc.id_process_category = @idProcess
      `);

    const condByFile = {};
    for (const c of condResult.recordset) {
      (condByFile[c.id_file] ||= []).push(c.id_option);
    }

    const response = files.map((f) => ({
      ...f,
      conditions: condByFile[f.id] || [],
    }));

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('Error en process-files:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
