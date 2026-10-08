import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

const MAX_NAME = 100;

/**
 * POST /api/assets/types  { name }
 *
 * Crea un tipo de activo y, con el mismo nombre, su primer tipo de equipo: cada activo se guarda
 * con un tipo de equipo (subtype_asset), así que un tipo sin equipos no se podría usar.
 */
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!name) {
      return NextResponse.json({ error: 'Escriba el nombre del tipo de activo.' }, { status: 400 });
    }
    if (name.length > MAX_NAME) {
      return NextResponse.json({ error: `El nombre no puede pasar de ${MAX_NAME} caracteres.` }, { status: 400 });
    }

    const result = await withMssqlPool(async (pool) => {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const existing = await new sql.Request(transaction)
          .input('name', sql.NVarChar(MAX_NAME), name)
          .query(`
            SELECT TOP 1 id FROM type_asset WITH (UPDLOCK, HOLDLOCK)
            WHERE UPPER(LTRIM(RTRIM(type_asset))) = @name`);
        if (existing.recordset.length) {
          await transaction.rollback();
          return { duplicate: true };
        }

        const type = await new sql.Request(transaction)
          .input('name', sql.NVarChar(MAX_NAME), name)
          .query(`INSERT INTO type_asset (type_asset) OUTPUT INSERTED.id VALUES (@name)`);
        const typeId = type.recordset[0].id;

        const subtype = await new sql.Request(transaction)
          .input('name', sql.NVarChar(MAX_NAME), name)
          .input('typeId', sql.Int, typeId)
          .query(`INSERT INTO subtype_asset (subtype_asset, id_type_asset) OUTPUT INSERTED.id VALUES (@name, @typeId)`);

        await transaction.commit();
        return { typeId, subtypeId: subtype.recordset[0].id };
      } catch (error) {
        await transaction.rollback().catch(() => {});
        throw error;
      }
    });

    if (result.duplicate) {
      return NextResponse.json({ error: `Ya existe el tipo de activo "${name}".` }, { status: 409 });
    }

    return NextResponse.json(
      {
        type: { id: result.typeId, tipo_activo: name },
        subtype: { id: result.subtypeId, subtipo_activo: name, id_tipo_activo: result.typeId },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('Error creando tipo de activo:', err);
    return NextResponse.json({ error: 'No se pudo crear el tipo de activo.' }, { status: 500 });
  }
}
