import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { NextResponse } from 'next/server';

async function ensurePreparersTable(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'preparers_process_category')
    BEGIN
      CREATE TABLE [dbo].[preparers_process_category] (
        [id]                   INT IDENTITY(1,1) NOT NULL,
        [id_preparer]          NVARCHAR(1000)    NOT NULL,
        [id_process_category]  INT               NOT NULL,
        CONSTRAINT [PK_preparers_process_category] PRIMARY KEY CLUSTERED ([id] ASC)
      );
      CREATE NONCLUSTERED INDEX [IX_preparers_process_category_process]
        ON [dbo].[preparers_process_category] ([id_process_category]);
      CREATE NONCLUSTERED INDEX [IX_preparers_process_category_user]
        ON [dbo].[preparers_process_category] ([id_preparer]);
    END
  `);
}

/** Preparadores documento de un proceso (para precargar el selector). */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id_process_category = searchParams.get('id_process_category');

    if (!id_process_category) {
      return NextResponse.json(
        { error: 'id_process_category es requerido' },
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    await ensurePreparersTable(pool);

    const result = await pool
      .request()
      .input('id_process_category', sql.Int, parseInt(id_process_category, 10))
      .query(
        `SELECT id_preparer FROM preparers_process_category WHERE id_process_category = @id_process_category`
      );

    const preparers = result.recordset.map((r) => String(r.id_preparer));

    return NextResponse.json({ preparers }, { status: 200 });
  } catch (err) {
    console.error('Error al obtener preparadores:', err);
    return NextResponse.json(
      { error: 'Error al obtener preparadores', details: err.message },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { preparers, id_process_category } = body;

    if (!Array.isArray(preparers) || !id_process_category) {
      return NextResponse.json(
        { message: 'Campos obligatorios faltantes' },
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    await ensurePreparersTable(pool);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      await new sql.Request(transaction)
        .input('id_process_category', sql.Int, id_process_category)
        .query(
          `DELETE FROM preparers_process_category WHERE id_process_category = @id_process_category`
        );

      const insertedIds = [];
      const unique = [
        ...new Set(
          preparers.map((p) => String(p || '').trim()).filter(Boolean)
        ),
      ];

      for (const preparer of unique) {
        const result = await new sql.Request(transaction)
          .input('id_preparer', sql.NVarChar(1000), preparer)
          .input('id_process_category', sql.Int, id_process_category)
          .query(`
            INSERT INTO preparers_process_category (
              id_preparer,
              id_process_category
            )
            OUTPUT INSERTED.id
            VALUES (
              @id_preparer,
              @id_process_category
            );
          `);
        insertedIds.push(result.recordset[0].id);
      }

      await transaction.commit();

      return NextResponse.json(
        {
          message: 'Preparadores documento asignados correctamente',
          count: insertedIds.length,
          ids: insertedIds,
        },
        { status: 201 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en transacción:', dbError);
      return NextResponse.json(
        {
          error: 'Error al asignar preparadores documento',
          details: dbError.message,
        },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error('Error general:', err);
    return NextResponse.json(
      { error: 'Error general', details: err.message },
      { status: 500 }
    );
  }
}
