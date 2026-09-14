import sql from 'mssql';
import sqlConfig from '../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const serial = searchParams.get('serial');
    const etiqueta = searchParams.get('etiqueta');
    const usuario = searchParams.get('usuario');
    const modelo = searchParams.get('modelo');
    const departamento = searchParams.get('departamento');
    const tipo_activo = searchParams.get('tipo_activo');
    const tipo_equipo = searchParams.get('tipo_equipo');
    const procesador = searchParams.get('procesador');
    const ram = searchParams.get('ram');
    const almacenamiento = searchParams.get('almacenamiento');
    const estado = searchParams.get('estado');
    const activo = searchParams.get('activo');
    const empresa = searchParams.get('empresa');

    let query = `
      
      SELECT
          a.id, a.name as nombre, a.model as modelo, a.id_subtype_asset as id_tipo_equipo, sa.subtype_asset tipo_equipo, ta.id as id_tipo_activo,
          ta.type_asset as tipo_activo ,a.id_user_asset as id_usuario, ua.username_asset as usuario, d.department as departamento, 
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

      WHERE 1=1
    `;

    if (serial) {
      query += ` AND a.serial LIKE '%' + @serial + '%'`;
      console.log('API assets: Agregando filtro por serial:', serial);
    }

    if (estado) {
      query += ` AND a.id_status_asset = @estado`;
      console.log('API assets: Agregando filtro por estado:', estado);
    }

    if (activo) {
      query += ` AND a.active = @activo`;
      console.log('API assets: Agregando filtro por activo:', activo);
    }

    if (etiqueta) {
      query += ` AND a.label LIKE '%' + @etiqueta + '%'`;
      console.log('API assets: Agregando filtro por etiqueta:', etiqueta);
    }

    if (usuario) {
      query += ` AND a.id_user_asset = @usuario`;
      console.log('API assets: Agregando filtro por usuario:', usuario);
    }

    if (modelo) {
      query += ` AND a.model LIKE '%' + @modelo + '%'`;
      console.log('API assets: Agregando filtro por modelo:', modelo);
    }

    if (departamento) {
      query += ` AND d.department LIKE '%' + @departamento + '%'`;
      console.log('API assets: Agregando filtro por departamento:', departamento);
    }

    if (tipo_activo) {
      query += ` AND ta.id = @tipo_activo`;
      console.log('API assets: Agregando filtro por tipo_activo:', tipo_activo);
    }

    // Se compara por id del subtipo: hay subtipos con el mismo nombre en
    // distintos tipos de activo, así que filtrar por texto traía de más.
    if (tipo_equipo) {
      query += ` AND a.id_subtype_asset = @tipo_equipo`;
      console.log('API assets: Agregando filtro por tipo_equipo:', tipo_equipo);
    }

    if (procesador) {
      query += ` AND a.processor LIKE '%' + @procesador + '%'`;
      console.log('API assets: Agregando filtro por procesador:', procesador);
    }

    if (ram) {
      query += ` AND a.ram LIKE '%' + @ram + '%'`;
      console.log('API assets: Agregando filtro por ram:', ram);
    }

    if (almacenamiento) {
      query += ` AND a.storage LIKE '%' + @almacenamiento + '%'`;
      console.log('API assets: Agregando filtro por almacenamiento:', almacenamiento);
    }

    if (empresa) {
      query += ` AND a.id_company_asset = @empresa`;
      console.log('API assets: Agregando filtro por empresa:', empresa);
    }

    query += ` ORDER BY a.id DESC`;

    const request = pool.request();

    if (serial) {
      request.input('serial', sql.NVarChar, serial);
    }

    if (estado) {
      request.input('estado', sql.Int, parseInt(estado));
    }

    if (activo) {
      // El front envía '1' / '0'; antes se comparaba contra 'true' y siempre daba 0.
      request.input('activo', sql.TinyInt, parseInt(activo));
    }

    if (etiqueta) {
      request.input('etiqueta', sql.NVarChar, etiqueta);
    }

    if (usuario) {
      request.input('usuario', sql.Int, parseInt(usuario));
    }

    if (modelo) {
      request.input('modelo', sql.NVarChar, modelo);
    }

    if (departamento) {
      request.input('departamento', sql.NVarChar, departamento);
    }

    if (tipo_activo) {
      request.input('tipo_activo', sql.Int, parseInt(tipo_activo));
    }

    if (tipo_equipo) {
      request.input('tipo_equipo', sql.Int, parseInt(tipo_equipo));
    }

    if (procesador) {
      request.input('procesador', sql.NVarChar, procesador);
    }

    if (ram) {
      request.input('ram', sql.NVarChar, ram);
    }

    if (almacenamiento) {
      request.input('almacenamiento', sql.NVarChar, almacenamiento);
    }

    if (empresa) {
      request.input('empresa', sql.Int, parseInt(empresa));
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
