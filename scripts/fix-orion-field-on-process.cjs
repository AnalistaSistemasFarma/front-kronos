/**
 * Agrega campo orion_signature al proceso de firmas (si falta).
 * Uso: node scripts/fix-orion-field-on-process.cjs [processId]
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const ORION_SIGNATURE_FIELD_TYPE = 'orion_signature';
const root = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m || process.env[m[1].trim()] !== undefined) continue;
  process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const processId = Number(process.argv[2] || 84);

(async () => {
  const db = require('../dbconfig.js').default || require('../dbconfig.js');
  const cfg = typeof db.buildMssqlConfig === 'function' ? db.buildMssqlConfig() : db;
  const pool = await sql.connect(cfg);

  const proc = await pool.request().input('id', sql.Int, processId).query(`
    SELECT pc.id, pc.process, cr.category FROM process_category pc
    JOIN category_request cr ON cr.id = pc.id_category_request WHERE pc.id = @id
  `);
  if (!proc.recordset[0]) {
    console.error('Proceso no encontrado:', processId);
    process.exit(1);
  }
  console.log('Proceso:', proc.recordset[0]);

  const exists = await pool
    .request()
    .input('pid', sql.Int, processId)
    .input('ft', sql.NVarChar(30), ORION_SIGNATURE_FIELD_TYPE)
    .query(`
      SELECT id FROM process_form_field
      WHERE id_process_category = @pid AND field_type = @ft
    `);

  if (exists.recordset[0]) {
    console.log('✓ Campo orion_signature ya existe (id=' + exists.recordset[0].id + ')');
  } else {
    const ins = await pool
      .request()
      .input('pid', sql.Int, processId)
      .input('label', sql.NVarChar(255), 'Firma digital')
      .input('ft', sql.NVarChar(30), ORION_SIGNATURE_FIELD_TYPE)
      .query(`
        INSERT INTO process_form_field (id_process_category, field_label, field_type, required, active, display_order)
        OUTPUT INSERTED.id
        VALUES (@pid, @label, @ft, 0, 1, 0)
      `);
    console.log('✓ Campo orion_signature creado (id=' + ins.recordset[0].id + ')');
  }

  console.log('\nRecarga la solicitud #2088 (F5). Debe aparecer el panel "Firma digital (GSS Firma)".');
  console.log('Orion debe estar corriendo en localhost:3000.');
  await pool.close();
})();
