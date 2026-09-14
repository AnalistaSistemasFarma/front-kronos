import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';

// Detalle de un activo. Lo usa la vista de detalle cuando se entra por enlace
// directo, sin pasar por el tablero (no hay nada en sessionStorage).
export async function GET(req, { params }) {
  try {
    const { id } = await params;

    if (!id || isNaN(parseInt(id))) {
      return NextResponse.json(
        { error: 'Identificador de activo inválido' },
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);

    const query = `
        SELECT
            a.id, a.name as nombre, a.model as modelo, a.id_subtype_asset as id_tipo_equipo, sa.subtype_asset tipo_equipo, ta.id as id_tipo_activo,
            ta.type_asset as tipo_activo, a.id_user_asset as id_usuario, ua.username_asset as usuario, d.department as departamento,
            a.serial, a.label as etiqueta, a.processor as procesador, a.ram, a.storage as almacenamiento, a.id_status_asset as id_estado_activo,
            sta.status_asset as estado, a.active as activo, a.equipment_cost as costo_equipo, a.purchaseDate as created_at, a.so, a.site as sitio, a.sim,
            a.invoice as factura, a.renovation as renovacion, a.date_renovation as renovacion_fecha, a.out_minute as acta_salida, a.id_company_asset,
            c.company as empresa
        FROM
            assets a
        INNER JOIN subtype_asset sa ON sa.id = a.id_subtype_asset
        INNER JOIN type_asset ta ON ta.id = sa.id_type_asset
        INNER JOIN user_asset ua ON ua.id = a.id_user_asset
        INNER JOIN department d ON d.id_department = ua.id_department
        INNER JOIN status_asset sta ON sta.id = a.id_status_asset
        INNER JOIN company c ON c.id_company= a.id_company_asset
        WHERE a.id = @id
    `;

    const request = pool.request();
    request.input('id', sql.Int, parseInt(id));

    const result = await request.query(query);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'Activo no encontrado' }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0], { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
