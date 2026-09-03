const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const root = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m || process.env[m[1].trim()] !== undefined) continue;
  process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const args = process.argv.slice(2).filter((a) => a !== '--delete');
const email = args[0] || 'juan.fonseca@gsslatam.com';
const doDelete = process.argv.includes('--delete');

(async () => {
  const db = require('../dbconfig.js').default || require('../dbconfig.js');
  const cfg = typeof db.buildMssqlConfig === 'function' ? db.buildMssqlConfig() : db;
  const pool = await sql.connect(cfg);

  const user = await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .query(`SELECT TOP 1 id, name, email FROM [user] WHERE LOWER(email) = LOWER(@email)`);

  if (!user.recordset[0]) {
    console.error('Usuario no encontrado:', email);
    await pool.close();
    process.exit(1);
  }

  const uid = user.recordset[0].id;
  console.log('Usuario:', user.recordset[0]);

  const list = await pool.request().input('uid', sql.NVarChar(255), uid).query(`
    SELECT rg.id, rg.subject_request, rg.status_req, rg.created_at, c.company, cr.category
    FROM requests_general rg
    LEFT JOIN company c ON c.id_company = rg.id_company
    LEFT JOIN process_category_request_general pcr ON pcr.id_request_general = rg.id
    LEFT JOIN process_category pc ON pc.id = pcr.id_process_category
    LEFT JOIN category_request cr ON cr.id = pc.id_category_request
    WHERE rg.id_requester = @uid
    ORDER BY rg.id DESC
  `);

  console.log(`Solicitudes encontradas: ${list.recordset.length}`);
  console.table(
    list.recordset.map((x) => ({
      id: x.id,
      subject: String(x.subject_request || '').slice(0, 60),
      status: x.status_req,
      company: x.company,
      category: x.category,
    }))
  );

  if (!doDelete) {
    console.log('Modo listado. Para borrar ejecuta con --delete');
    await pool.close();
    return;
  }

  if (list.recordset.length === 0) {
    console.log('Nada que borrar.');
    await pool.close();
    return;
  }

  const ids = list.recordset.map((r) => r.id);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = () => new sql.Request(tx);

    // Dependencias habituales de requests_general
    for (const id of ids) {
      await req().input('id', sql.Int, id).query(`
        DELETE FROM notes WHERE id_request = @id;
        DELETE FROM request_form_value WHERE id_request_general = @id;
        DELETE FROM task_request_general WHERE id_request_general = @id;
        DELETE FROM process_category_request_general WHERE id_request_general = @id;
        DELETE FROM requests_general WHERE id = @id;
      `);
      console.log('Borrada solicitud #', id);
    }

    await tx.commit();
    console.log(`OK: ${ids.length} solicitudes eliminadas.`);
  } catch (err) {
    await tx.rollback();
    console.error('Error borrando, rollback:', err.message || err);
    process.exitCode = 1;
  }

  await pool.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
