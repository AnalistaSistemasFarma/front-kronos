import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

async function ensureValidatorsTable(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'validators_process_category')
    BEGIN
      CREATE TABLE [dbo].[validators_process_category] (
        [id]                   INT IDENTITY(1,1) NOT NULL,
        [id_validator]         NVARCHAR(1000)    NOT NULL,
        [id_process_category]  INT               NOT NULL,
        [sequence_order]       INT               NOT NULL,
        CONSTRAINT [PK_validators_process_category] PRIMARY KEY CLUSTERED ([id] ASC)
      );
      CREATE NONCLUSTERED INDEX [IX_validators_process_category_process]
        ON [dbo].[validators_process_category] ([id_process_category], [sequence_order]);
    END
  `);
}

/**
 * Personas validadoras de un flujo. sequence_order ya no define el orden de aprobación:
 * ese lo elige el preparador por documento en los archivos adjuntos.
 */
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id_process_category = Number(searchParams.get('id_process_category'));
    if (!Number.isInteger(id_process_category) || id_process_category <= 0) {
      return NextResponse.json({ error: 'id_process_category es requerido' }, { status: 400 });
    }

    const pool = await sql.connect(sqlConfig);
    await ensureValidatorsTable(pool);

    const result = await pool
      .request()
      .input('id_process_category', sql.Int, id_process_category)
      .query(`
        SELECT id_validator
        FROM validators_process_category
        WHERE id_process_category = @id_process_category
        ORDER BY sequence_order, id
      `);

    return NextResponse.json(
      { validators: result.recordset.map((r) => String(r.id_validator)) },
      { status: 200 }
    );
  } catch (err) {
    console.error('Error al obtener validadores:', err);
    return NextResponse.json(
      { error: 'Error al obtener validadores', details: err.message },
      { status: 500 }
    );
  }
}

/** Reemplaza el grupo completo de validadores del flujo. */
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json();
    const { validators, id_process_category } = body;
    const processId = Number(id_process_category);

    if (!Array.isArray(validators) || !Number.isInteger(processId) || processId <= 0) {
      return NextResponse.json({ message: 'Campos obligatorios faltantes' }, { status: 400 });
    }

    const ordered = [];
    for (const raw of validators) {
      const id = String(raw || '').trim();
      if (id && !ordered.includes(id)) ordered.push(id);
    }

    const pool = await sql.connect(sqlConfig);
    await ensureValidatorsTable(pool);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      await new sql.Request(transaction)
        .input('id_process_category', sql.Int, processId)
        .query(`DELETE FROM validators_process_category WHERE id_process_category = @id_process_category`);

      for (let index = 0; index < ordered.length; index += 1) {
        await new sql.Request(transaction)
          .input('id_validator', sql.NVarChar(1000), ordered[index])
          .input('id_process_category', sql.Int, processId)
          .input('sequence_order', sql.Int, index + 1)
          .query(`
            INSERT INTO validators_process_category (id_validator, id_process_category, sequence_order)
            VALUES (@id_validator, @id_process_category, @sequence_order)
          `);
      }

      await transaction.commit();

      return NextResponse.json(
        { message: 'Validadores asignados correctamente', count: ordered.length },
        { status: 201 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en transacción de validadores:', dbError);
      return NextResponse.json(
        { error: 'Error al asignar validadores', details: dbError.message },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error('Error general validadores:', err);
    return NextResponse.json({ error: 'Error general', details: err.message }, { status: 500 });
  }
}
