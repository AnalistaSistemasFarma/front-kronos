import { sql, getPool } from '../../../../lib/mssqlPool';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    
    const pool = await getPool();

    const queryTypeAsset = `
        SELECT 
            ta.id, ta.type_asset as tipo_activo
        FROM 
            type_asset ta
        ORDER BY ta.type_asset
    `;

    const querySubTypeAsset = `
        SELECT 
            sa.id, sa.subtype_asset as subtipo_activo, sa.id_type_asset as id_tipo_activo
        FROM 
            subtype_asset sa
        ORDER BY sa.subtype_asset
    `;

    const queryDepartments = `
        SELECT 
            d.id_department as id, d.department as departamento
        FROM 
            department d
        ORDER BY d.department
    `;

    const queryUsers = `
        SELECT 
            ua.id, ua.username_asset as nombre_usuario, ua.rol as cargo, ua.identification as cedula, ua.email as correo,
            ua.id_department as id_departamento
        FROM 
            user_asset ua
        ORDER BY ua.username_asset
    `;

    const queryCompanies = `
        SELECT
            c.id_company as id, c.company as empresa
        FROM
            company c
        ORDER BY c.company
    `;

    const [typeRes, subtypesRes, departmentsRes, usersRes, companiesRes] =
      await Promise.all([
        pool.request().query(queryTypeAsset),
        pool.request().query(querySubTypeAsset),
        pool.request().query(queryDepartments),
        pool.request().query(queryUsers),
        pool.request().query(queryCompanies),
      ]);


    return NextResponse.json(
      {
        types: typeRes.recordset,
        subtypes: subtypesRes.recordset,
        departments: departmentsRes.recordset,
        users: usersRes.recordset,
        companies: companiesRes.recordset,
      },
      { status: 200 }
    );

  } catch (err) {

    console.error('Error en endpoint:', err);

    return NextResponse.json(
      {
        error: 'Error procesando la solicitud',
        details: err.message,
      },
      { status: 500 }
    );
  }
}
