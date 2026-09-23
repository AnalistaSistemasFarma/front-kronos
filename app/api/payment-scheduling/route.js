import sql from 'mssql';
import sqlConfig from '../../../dbconfig';
import { NextResponse } from 'next/server';

export async function GET(req) {
  try {
    const pool = await sql.connect(sqlConfig);

    const { searchParams } = new URL(req.url);
    const id_tarea = searchParams.get('id_tarea');
    const id_solicitud = searchParams.get('id_solicitud');
    const tipo_solicitud = searchParams.get('tipo_solicitud');
    const subtipo_solicitud = searchParams.get('subtipo_solicitud');
    const status = searchParams.get('status');
    const company = searchParams.get('company');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');

    let query = `
      
        SELECT 
            trg.id AS id_tarea,
            tpc.task AS tarea,
            trg.id_request_general AS id_solicitud,
            trg.id_status AS id_estado_solicitud,
            sc.status AS estado_tarea,
            trg.id_assigned AS id_asignado_tarea,
            ua.name AS usuario_asignado,
            trg.start_date AS fecha_inicio_tarea,
            trg.end_date AS fecha_fin_tarea,
            trg.active AS activo,
            trg.resolution AS resolución_tarea,
            trg.date_resolution AS fecha_resolucion_tarea,
            pc.process AS proceso_solicitud,
            rg.subject_request as asunto_solicitud,
            rg.description as descripción_solicitud,
            rg.id_company as id_empresa,
            c.company as empresa,
            rg.created_at as fecha_creación_solicitud,
            rg.id_requester as id_creador_solicitud,
            uc.name as creador_solicitud,

            MAX(CASE 
                WHEN f.field_label = 'Tipo de Solicitud'
                THEN COALESCE(rfv.value_text, o.option_label)
            END) AS tipo_solicitud,

            MAX(CASE 
                WHEN f.field_label LIKE 'Subtipo de Solicitud%'
                THEN COALESCE(rfv.value_text, o.option_label)
            END) AS subtipo_solicitud,

            MAX(CASE 
                WHEN f.field_label = 'Valor a Pagar'
                THEN rfv.value_text
            END) AS valor_pagar,

            MAX(CASE 
                WHEN f.field_label = 'Fecha Solicitada de Pago'
                THEN rfv.value_text
            END) AS fecha_solicitada_pago,

            MAX(CASE 
                WHEN f.field_label = 'Acreedor'
                THEN rfv.value_text
            END) AS acreedor

        FROM task_request_general trg

        INNER JOIN task_process_category tpc 
            ON trg.id_task = tpc.id

        INNER JOIN requests_general rg
            ON rg.id = trg.id_request_general

        INNER JOIN company c
            ON c.id_company = rg.id_company

        INNER JOIN [user] uc
	        ON uc.id = rg.id_requester

        INNER JOIN status_case sc 
            ON sc.id_status_case = trg.id_status

        LEFT JOIN [user] ua 
            ON ua.id = trg.id_assigned

        INNER JOIN process_category_request_general pcrg 
            ON trg.id_request_general = pcrg.id_request_general

        INNER JOIN process_category pc 
            ON pcrg.id_process_category = pc.id

        INNER JOIN request_form_value rfv 
            ON trg.id_request_general = rfv.id_request_general

        INNER JOIN process_form_field f 
            ON f.id = rfv.id_form_field

        LEFT JOIN process_form_field_option o 
            ON o.id = rfv.id_option

        WHERE tpc.task LIKE '%Programación de Pago%'

    `;

    if (id_tarea) {
      query += ` AND trg.id = @id_tarea`;
      console.log('API assets: Agregando filtro por id_tarea:', id_tarea);
    }

    if (id_solicitud) {
      query += ` AND trg.id_request_general = @id_solicitud`;
      console.log('API assets: Agregando filtro por id_solicitud:', id_solicitud);
    }

    if (tipo_solicitud && tipo_solicitud !== '0') {
      query += `
        AND EXISTS (
          SELECT 1
          FROM request_form_value rfv_t
          INNER JOIN process_form_field f_t ON f_t.id = rfv_t.id_form_field
          LEFT JOIN process_form_field_option o_t ON o_t.id = rfv_t.id_option
          WHERE rfv_t.id_request_general = trg.id_request_general
            AND f_t.field_label = 'Tipo de Solicitud'
            AND COALESCE(rfv_t.value_text, o_t.option_label) LIKE '%' + @tipo_solicitud + '%'
        )`;
      console.log('API assets: Agregando filtro por tipo_solicitud:', tipo_solicitud);
    }

    if (subtipo_solicitud  && subtipo_solicitud !== '0') {
      query += `
        AND EXISTS (
          SELECT 1
          FROM request_form_value rfv_s
          INNER JOIN process_form_field f_s ON f_s.id = rfv_s.id_form_field
          LEFT JOIN process_form_field_option o_s ON o_s.id = rfv_s.id_option
          WHERE rfv_s.id_request_general = trg.id_request_general
            AND f_s.field_label LIKE 'Subtipo de Solicitud%'
            AND COALESCE(rfv_s.value_text, o_s.option_label) LIKE '%' + @subtipo_solicitud + '%'
        )`;
      console.log('API assets: Agregando filtro por subtipo_solicitud:', subtipo_solicitud);
    }

    if (status && status !== '0') {
      query += ` AND trg.id_status = @status`;
      console.log('API assets: Agregando filtro por status:', status);
    }

    if (company && company !== '0') {
      query += ` AND rg.id_company = @company`;
      console.log('API assets: Agregando filtro por company:', company);
    }

    if (date_from) {
      query += ` AND rg.created_at >= @date_from`;
      console.log('API assets: Agregando filtro por date_from:', date_from);
    }

    if (date_to) {
      query += ` AND rg.created_at <= @date_to`;
      console.log('API assets: Agregando filtro por date_to:', date_to);
    }

    query += ` 

        GROUP BY
        trg.id,
        tpc.task,
        trg.id_request_general,
        trg.id_status,
        sc.status,
        trg.id_assigned,
        ua.name,
        trg.start_date,
        trg.end_date,
        trg.active,
        trg.resolution,
        trg.date_resolution,
        pc.process,
        rg.subject_request,
        rg.description,
        rg.id_company,
        c.company,
        rg.created_at,
        rg.id_requester,
        uc.name

        ORDER BY trg.id DESC;

    `;

    const request = pool.request();

    if (id_tarea) {
      request.input('id_tarea', sql.Int, parseInt(id_tarea));
    }

    if (id_solicitud) {
      request.input('id_solicitud', sql.Int, parseInt(id_solicitud));
    }

    if (tipo_solicitud && tipo_solicitud !== '0') {
      request.input('tipo_solicitud', sql.NVarChar, tipo_solicitud);
    }

    if (subtipo_solicitud && subtipo_solicitud !== '0') {
      request.input('subtipo_solicitud', sql.NVarChar, subtipo_solicitud);
    }

    if (status) {
      request.input('status', sql.Int, parseInt(status));
    }

    if (company && company !== '0') {
      request.input('company', sql.Int, parseInt(company));
    }

    if (date_from) {
      request.input('date_from', sql.DateTime, new Date(date_from));
    }

    if (date_to) {
      request.input('date_to', sql.DateTime, new Date(date_to));
    }

    console.log('API PAYMENTS_SCHEDULING: Ejecutando consulta:', query);
    const result = await request.query(query);
    console.log(
      'API PAYMENTS_SCHEDULING: Resultados obtenidos:',
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
