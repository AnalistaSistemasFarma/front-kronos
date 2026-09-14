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
            ds.id as id_document, ds.id_user, ua.username_asset as usuario, ua.identification as cedula, ua.rol as cargo,
            ua.id_department, d.department as departamento, ds.place as sede, ds.delivery_date as fecha_entrega, ds.name_technical_delivery
            as nombre_tecnico_entrego, ds.signature_received as firma_recibio, ds.devolution_date as fecha_devolucion,
            ds.name_technical_received as nombre_tecnico_recibio, ds.signature_devolution as firma_devolucion, ds.active_minute as activo_minuto
        FROM 
            document_signatures ds
        INNER JOIN user_asset ua ON ua.id = ds.id_user
        INNER JOIN department d ON d.id_department = ua.id_department

        WHERE 1=1
    `;

    if (idAsset) {
      query += ` AND ds.id_assets = @idAsset`;
      console.log('API assets: Agregando filtro por ID de activo:', idAsset);
    }

    query += ` ORDER BY ds.id DESC`;

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
