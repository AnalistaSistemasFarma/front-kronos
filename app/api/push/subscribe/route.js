import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';

export async function POST(req) {
  try {
    const body = await req.json();
    const { email, subscription } = body;

    if (!email || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return new Response(JSON.stringify({ error: 'Payload inválido' }), { status: 400 });
    }

    const pool = await sql.connect(sqlConfig);

    const existing = await pool
      .request()
      .input('endpoint', sql.NVarChar(sql.MAX), subscription.endpoint)
      .query(`SELECT id FROM push_subscriptions WHERE CAST(endpoint AS NVARCHAR(450)) = CAST(@endpoint AS NVARCHAR(450))`);

    if (existing.recordset.length > 0) {
      await pool
        .request()
        .input('id', sql.Int, existing.recordset[0].id)
        .input('email', sql.NVarChar(255), email)
        .input('p256dh', sql.NVarChar(255), subscription.keys.p256dh)
        .input('auth', sql.NVarChar(255), subscription.keys.auth)
        .query(`
          UPDATE push_subscriptions
          SET email = @email, p256dh = @p256dh, auth = @auth
          WHERE id = @id
        `);
    } else {
      await pool
        .request()
        .input('email', sql.NVarChar(255), email)
        .input('endpoint', sql.NVarChar(sql.MAX), subscription.endpoint)
        .input('p256dh', sql.NVarChar(255), subscription.keys.p256dh)
        .input('auth', sql.NVarChar(255), subscription.keys.auth)
        .query(`
          INSERT INTO push_subscriptions (email, endpoint, p256dh, auth)
          VALUES (@email, @endpoint, @p256dh, @auth)
        `);
    }

    return new Response(JSON.stringify({ success: true }), { status: 201 });
  } catch (err) {
    console.error('[push/subscribe POST] Error:', err);
    return new Response(JSON.stringify({ error: 'Error al guardar suscripción', details: err.message }), { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const body = await req.json();
    const { endpoint } = body;
    if (!endpoint) {
      return new Response(JSON.stringify({ error: 'endpoint requerido' }), { status: 400 });
    }

    const pool = await sql.connect(sqlConfig);
    await pool
      .request()
      .input('endpoint', sql.NVarChar(sql.MAX), endpoint)
      .query(`DELETE FROM push_subscriptions WHERE CAST(endpoint AS NVARCHAR(450)) = CAST(@endpoint AS NVARCHAR(450))`);

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error('[push/subscribe DELETE] Error:', err);
    return new Response(JSON.stringify({ error: 'Error al eliminar suscripción', details: err.message }), { status: 500 });
  }
}
