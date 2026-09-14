import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const idAsset = searchParams.get('idAsset');

    let query = `
      
        SELECT
            la.id, la.log_asset as mensaje, la.creation_date as fecha, la.id_asset
        FROM
            log_asset la

        WHERE 1=1
    `;

    if (idAsset) {
      query += ` AND la.id_asset = @idAsset`;
      console.log('API assets: Agregando filtro por idAsset:', idAsset);
    }

    query += ` ORDER BY la.id DESC`;

    const request = pool.request();

    if (idAsset) {
      request.input('idAsset', sql.Int, parseInt(idAsset));
    }

    console.log('API assets: Ejecutando consulta:', query);
    const result = await request.query(query);
    console.log(
      'API assets: Resultados obtenidos:',
      result.recordset.length,
      'registros'
    );

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
