/**
 * Diagnóstico solicitud Orion: creador, status, versiones UI.
 * node scripts/diag-orion-request.cjs --requestId=2131
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

function loadEnv() {
  for (const line of fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const requestId = Number(
    (process.argv.find((a) => a.startsWith('--requestId=')) || '').split('=')[1] || 2131
  );
  const pool = await sql.connect({
    server: process.env.SAPSENDSQL_SERVER,
    database: process.env.SAPSENDSQL_BD,
    user: process.env.SAPSENDSQL_USER,
    password: process.env.SAPSENDSQL_PASS,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const req = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT rg.id, rg.subject_request, rg.status_req, rg.id_requester, u.email AS requester_email, u.name AS requester_name,
           rg.resolution, rg.date_resolution
    FROM requests_general rg
    LEFT JOIN [user] u ON u.id = rg.id_requester
    WHERE rg.id = @id
  `);
  console.log('REQUEST', req.recordset[0]);

  const notes = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT TOP 20 id, note, created_by, creation_date
    FROM notes_request_general
    WHERE id_request_general = @id
    ORDER BY id DESC
  `).catch(async () => {
    // try alternate table names
    const alt = await pool.request().input('id', sql.Int, requestId).query(`
      SELECT TOP 20 *
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE '%note%' OR TABLE_NAME LIKE '%interac%'
    `);
    console.log('NOTE TABLES', alt.recordset);
    return { recordset: [] };
  });
  console.log('NOTES', notes.recordset);

  const field = await pool
    .request()
    .input('id', sql.Int, requestId)
    .input('fieldType', sql.NVarChar(30), 'orion_signature')
    .query(`
      SELECT TOP 1 rfv.value_text
      FROM process_category_request_general pcr
      INNER JOIN process_form_field pff ON pff.id_process_category = pcr.id_process_category
      LEFT JOIN request_form_value rfv ON rfv.id_form_field = pff.id AND rfv.id_request_general = @id
      WHERE pcr.id_request_general = @id AND pff.field_type = @fieldType AND pff.active = 1
    `);
  const bag = JSON.parse(field.recordset[0]?.value_text || '{}');
  for (const [fid, doc] of Object.entries(bag.documents || {})) {
    console.log('DOC', fid, {
      status: doc.status,
      fileName: doc.fileName,
      signers: (doc.signers || []).map((s) => ({ email: s.email, order: s.order, status: s.status })),
      versions: (doc.versions || []).map((v) => ({ id: v.id, kind: v.kind, createdAt: v.createdAt, label: v.label })),
    });
  }

  const tasks = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT trg.id, trg.id_status, CAST(trg.id_assigned AS NVARCHAR(255)) AS id_assigned,
           u.email, tpc.task, tpc.is_authorization, LEFT(ISNULL(trg.resolution,''), 100) AS resolution
    FROM task_request_general trg
    INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
    LEFT JOIN [user] u ON CAST(u.id AS NVARCHAR(255)) = CAST(trg.id_assigned AS NVARCHAR(255))
    WHERE trg.id_request_general = @id
    ORDER BY trg.id DESC
  `);
  console.log('TASKS');
  for (const t of tasks.recordset) {
    console.log(`  #${t.id} st=${t.id_status} auth=${t.is_authorization} ${t.email || t.id_assigned} :: ${t.task} :: ${t.resolution}`);
  }

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
