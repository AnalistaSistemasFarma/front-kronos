import sql from 'mssql';
import sqlConfig from '../../../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const idAsset = searchParams.get('idAsset');

    let query = `
      
        SELECT 
            1
        FROM 
            document_signatures da

        WHERE da.active_minute = 1
    `;

    if (idAsset) {
      query += ` AND da.id_assets = @idAsset`;
      console.log('API assets: Agregando filtro por idAsset:', idAsset);
    }

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
