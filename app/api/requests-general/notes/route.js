import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { NextResponse } from 'next/server';

// GET - Obtener notas de un caso
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id_request = searchParams.get('id_request');

    if (!id_request) {
      return NextResponse.json(
        { error: 'El id_request es requerido' },
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);

    const query = `
      SELECT n.id_note, n.note, u.name as 'createdBy', n.creation_date
      FROM notes n
      INNER JOIN [user] u ON u.id = n.created_by
      WHERE n.id_request = @id_request
      ORDER BY n.id_note DESC
    `;

    const request = pool.request();
    request.input('id_request', sql.Int, id_request);

    const result = await request.query(query);

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error al consultar notas:', err);
    return NextResponse.json(
      {
        error: 'Error al consultar las notas',
        details: 'No se pudieron obtener las notas. Por favor intente nuevamente.',
        technical: err.message,
      },
      { status: 500 }
    );
  }
}

// POST - Agregar una nueva nota a un caso
export async function POST(req) {
  try {
    const body = await req.json();
    const { id_request, note, created_by } = body;

    if (!id_request || !note || note.trim() === '') {
      return new Response(
        JSON.stringify({
          error: 'Campos obligatorios faltantes',
          details: 'El id_request y el contenido de la nota son requeridos',
        }),
        { status: 400 }
      );
    }

    if (!created_by) {
      return new Response(
        JSON.stringify({
          error: 'Campo obligatorio faltante',
          details: 'El campo created_by es requerido',
        }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const insertNoteQuery = `
        INSERT INTO notes (note, id_request, created_by)
        OUTPUT INSERTED.id_note
        VALUES (@note, @id_request, @created_by);
      `;

      const request = new sql.Request(transaction);
      request.input('note', sql.Text, note.trim());
      request.input('id_request', sql.Int, id_request);
      request.input('created_by', sql.NVarChar, created_by);

      const result = await request.query(insertNoteQuery);
      const newNoteId = result.recordset[0].id_note;

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'Nota agregada exitosamente',
          id_note: newNoteId,
          success: true,
        }),
        { status: 201 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error('Error al agregar nota:', dbError);
      return new Response(
        JSON.stringify({
          error: 'Error al agregar la nota en la base de datos',
          details: 'No se pudo guardar la nota. Por favor intente nuevamente.',
          technical: dbError.message,
        }),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error('Error general en la solicitud:', err);
    return new Response(
      JSON.stringify({
        error: 'Error del servidor al procesar la solicitud',
        details: 'Ocurrió un error inesperado. Por favor intente nuevamente más tarde.',
        technical: err.message,
      }),
      { status: 500 }
    );
  }
}