const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const root = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m || process.env[m[1].trim()] !== undefined) continue;
  process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

(async () => {
  const db = require('../dbconfig.js').default || require('../dbconfig.js');
  const cfg = typeof db.buildMssqlConfig === 'function' ? db.buildMssqlConfig() : db;
  const pool = await sql.connect(cfg);
  const requestId = 2088;

  const req = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT rg.id, rg.subject_request, pc.id AS process_id, pc.process, cr.category
    FROM requests_general rg
    LEFT JOIN process_category_request_general pcr ON pcr.id_request_general = rg.id
    LEFT JOIN process_category pc ON pc.id = pcr.id_process_category
    LEFT JOIN category_request cr ON cr.id = pc.id_category_request
    WHERE rg.id = @id
  `);
  console.log('Solicitud:', req.recordset[0]);

  const processId = req.recordset[0]?.process_id;
  if (processId) {
    const fields = await pool.request().input('pid', sql.Int, processId).query(`
      SELECT id, field_label, field_type, active FROM process_form_field
      WHERE id_process_category = @pid ORDER BY display_order, id
    `);
    console.log('\nCampos del proceso:');
    console.log(fields.recordset);
    const hasOrion = fields.recordset.some((f) => f.field_type === 'orion_signature');
    console.log('\norion_signature presente:', hasOrion ? 'SÍ' : 'NO — este es el problema');
  }

  const formValues = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT pff.field_type, pff.field_label, rfv.value_text
    FROM process_category_request_general pcr
    INNER JOIN process_form_field pff ON pff.id_process_category = pcr.id_process_category
    LEFT JOIN request_form_value rfv ON rfv.id_form_field = pff.id AND rfv.id_request_general = @id
    WHERE pcr.id_request_general = @id
  `);
  console.log('\nValores formulario solicitud:', formValues.recordset);

  await pool.close();
})();
