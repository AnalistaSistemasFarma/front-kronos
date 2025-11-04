import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { NextResponse } from 'next/server';

// GET - Obtener notas de un caso
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id_case = searchParams.get('id_case');

    if (!id_case) {
      return NextResponse.json(
        { error: 'El id_case es requerido' },
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);

    const query = `
      SELECT n.id_note, n.note 
      FROM notes n 
      WHERE n.id_case = @id_case
      ORDER BY n.id_note DESC
    `;

    const request = pool.request();
    request.input('id_case', sql.Int, id_case);

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
    const { id_case, note } = body;

    if (!id_case || !note || note.trim() === '') {
      return new Response(
        JSON.stringify({
          error: 'Campos obligatorios faltantes',
          details: 'El id_case y el contenido de la nota son requeridos',
        }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const insertNoteQuery = `
        INSERT INTO notes (note, id_case)
        OUTPUT INSERTED.id_note
        VALUES (@note, @id_case);
      `;

      const request = new sql.Request(transaction);
      request.input('note', sql.Text, note.trim());
      request.input('id_case', sql.Int, id_case);

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