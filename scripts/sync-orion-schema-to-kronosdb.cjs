/**
 * Sincroniza datos de esquema/catálogo Orion (firma) de KRONOSDB_PRUEBAS → KRONOSDB.
 * No copia datos transaccionales (solicitudes). Solo catálogo necesario para que
 * firma funcione en prod.
 *
 * Uso:
 *   node scripts/sync-orion-schema-to-kronosdb.cjs --dry-run
 *   node scripts/sync-orion-schema-to-kronosdb.cjs --apply
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const SOURCE_DB = 'KRONOSDB_PRUEBAS';
const TARGET_DB = 'KRONOSDB';

const FIRMA_TYPES = [
  'Firma — Abogado',
  'Firma — Dueño',
  'Firma — Gerente',
  'Firma — Empleado',
  'Firma — Aprobación envío',
];

const SUBPROCESSES = [
  { name: 'Preparar firma', url: '/process/firma/prepare' },
  { name: 'Firmar documento', url: '/process/firma/sign' },
  { name: 'Firma digital', url: '/process/firma/manage' }, // legacy alias preparar
];

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

loadEnv();
const cfg = require('../dbconfig');

async function withDb(database, fn) {
  const c = cfg.buildMssqlConfig();
  c.database = database;
  if (!c.server) throw new Error('server vacío');
  const pool = await new sql.ConnectionPool(c).connect();
  try {
    return await fn(pool);
  } finally {
    await pool.close();
  }
}

async function q(pool, text, inputs = {}) {
  const req = pool.request();
  for (const [k, v] of Object.entries(inputs)) {
    if (typeof v === 'number') req.input(k, sql.Int, v);
    else if (typeof v === 'boolean') req.input(k, sql.Bit, v);
    else req.input(k, sql.NVarChar(sql.MAX), v);
  }
  return (await req.query(text)).recordset;
}

async function inspect(pool, label) {
  const types = await q(
    pool,
    `SELECT id, type_authorization FROM types_authorization
     WHERE type_authorization LIKE N'%Firma%'
     ORDER BY id`
  );
  const subs = await q(
    pool,
    `SELECT id_subprocess, subprocess, subprocess_url
     FROM subprocess
     WHERE subprocess_url LIKE N'%/process/firma/%'
        OR LOWER(subprocess) LIKE N'%preparar firma%'
        OR LOWER(subprocess) LIKE N'%firmar documento%'
        OR LOWER(subprocess) LIKE N'%firma digital%'
     ORDER BY id_subprocess`
  );
  const fields = await q(
    pool,
    `SELECT pff.id, pff.id_process_category, pc.process, pff.field_label, pff.active
     FROM process_form_field pff
     LEFT JOIN process_category pc ON pc.id = pff.id_process_category
     WHERE pff.field_type = N'orion_signature'
     ORDER BY pff.id`
  );
  console.log(`\n[${label}] types:`, types.map((t) => t.type_authorization));
  console.log(`[${label}] subprocesses:`, subs);
  console.log(`[${label}] orion_signature fields:`, fields);
  return { types, subs, fields };
}

async function ensureTypes(pool, apply) {
  const actions = [];
  for (const name of FIRMA_TYPES) {
    const existing = await q(
      pool,
      `SELECT TOP 1 id FROM types_authorization WHERE type_authorization = @name`,
      { name }
    );
    if (existing[0]) {
      actions.push({ kind: 'types_authorization', name, status: 'exists', id: existing[0].id });
      continue;
    }
    actions.push({ kind: 'types_authorization', name, status: apply ? 'insert' : 'would-insert' });
    if (apply) {
      await q(
        pool,
        `INSERT INTO types_authorization (type_authorization) VALUES (@name)`,
        { name }
      );
    }
  }
  return actions;
}

async function ensureSubprocesses(pool, apply) {
  const actions = [];
  // Detect parent process id used by other process-hub subprocesses if required
  const sample = await q(
    pool,
    `SELECT TOP 1 id_process FROM subprocess WHERE subprocess_url LIKE N'/process/%' ORDER BY id_subprocess`
  );
  const idProcess = sample[0]?.id_process ?? null;

  for (const sp of SUBPROCESSES) {
    const existing = await q(
      pool,
      `SELECT TOP 1 id_subprocess, subprocess, subprocess_url
       FROM subprocess
       WHERE LOWER(LTRIM(RTRIM(ISNULL(subprocess_url,N'')))) = LOWER(LTRIM(RTRIM(@url)))
          OR LOWER(LTRIM(RTRIM(ISNULL(subprocess,N'')))) = LOWER(LTRIM(RTRIM(@name)))
       ORDER BY id_subprocess`,
      { url: sp.url, name: sp.name }
    );
    if (existing[0]) {
      actions.push({
        kind: 'subprocess',
        name: sp.name,
        url: sp.url,
        status: 'exists',
        id: existing[0].id_subprocess,
      });
      // Fix URL if name matched but URL empty/wrong
      if (
        apply &&
        String(existing[0].subprocess_url || '').trim().toLowerCase() !== sp.url.toLowerCase()
      ) {
        await q(
          pool,
          `UPDATE subprocess SET subprocess_url = @url, subprocess = @name WHERE id_subprocess = @id`,
          { url: sp.url, name: sp.name, id: existing[0].id_subprocess }
        );
        actions[actions.length - 1].status = 'updated-url';
      }
      continue;
    }

    actions.push({
      kind: 'subprocess',
      name: sp.name,
      url: sp.url,
      status: apply ? 'insert' : 'would-insert',
      idProcess,
    });
    if (apply) {
      if (idProcess == null) {
        // Try insert with only known columns
        const cols = await q(
          pool,
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = N'subprocess'`
        );
        const names = new Set(cols.map((c) => c.COLUMN_NAME.toLowerCase()));
        if (names.has('id_process')) {
          throw new Error(
            'No se pudo inferir id_process para insertar subprocess. Cree Preparar firma / Firmar documento manualmente en Administración.'
          );
        }
        await q(
          pool,
          `INSERT INTO subprocess (subprocess, subprocess_url) VALUES (@name, @url)`,
          { name: sp.name, url: sp.url }
        );
      } else {
        await q(
          pool,
          `INSERT INTO subprocess (subprocess, subprocess_url, id_process)
           VALUES (@name, @url, @idProcess)`,
          { name: sp.name, url: sp.url, idProcess }
        );
      }
    }
  }
  return actions;
}

async function ensureOrionFieldsFromSource(sourcePool, targetPool, apply) {
  const actions = [];
  const sourceFields = await q(
    sourcePool,
    `SELECT pff.id_process_category, pc.process AS process_name, pff.field_label, pff.display_order, pff.required, pff.active
     FROM process_form_field pff
     INNER JOIN process_category pc ON pc.id = pff.id_process_category
     WHERE pff.field_type = N'orion_signature'`
  );

  for (const sf of sourceFields) {
    const targetProc = await q(
      targetPool,
      `SELECT TOP 1 id, process FROM process_category
       WHERE LOWER(LTRIM(RTRIM(process))) = LOWER(LTRIM(RTRIM(@name)))
       ORDER BY active DESC, id DESC`,
      { name: sf.process_name }
    );
    if (!targetProc[0]) {
      actions.push({
        kind: 'orion_signature',
        process: sf.process_name,
        status: 'skipped-no-process-in-target',
      });
      continue;
    }
    const pid = targetProc[0].id;
    const existing = await q(
      targetPool,
      `SELECT TOP 1 id FROM process_form_field
       WHERE id_process_category = @pid AND field_type = N'orion_signature'`,
      { pid }
    );
    if (existing[0]) {
      actions.push({
        kind: 'orion_signature',
        process: sf.process_name,
        processId: pid,
        status: 'exists',
        id: existing[0].id,
      });
      continue;
    }
    actions.push({
      kind: 'orion_signature',
      process: sf.process_name,
      processId: pid,
      status: apply ? 'insert' : 'would-insert',
    });
    if (apply) {
      await q(
        targetPool,
        `INSERT INTO process_form_field
           (id_process_category, field_label, field_type, required, active, display_order)
         VALUES (@pid, @label, N'orion_signature', @required, @active, @ord)`,
        {
          pid,
          label: sf.field_label || 'Firma digital',
          required: sf.required ? 1 : 0,
          active: sf.active ? 1 : 0,
          ord: Number(sf.display_order) || 900,
        }
      );
    }
  }
  return actions;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dry = process.argv.includes('--dry-run') || !apply;
  console.log(`Fuente: ${SOURCE_DB} → Destino: ${TARGET_DB} (${apply ? 'APPLY' : 'DRY-RUN'})`);

  await withDb(SOURCE_DB, (p) => inspect(p, SOURCE_DB));
  await withDb(TARGET_DB, (p) => inspect(p, `${TARGET_DB} antes`));

  const allActions = [];
  await withDb(TARGET_DB, async (target) => {
    allActions.push(...(await ensureTypes(target, apply)));
    allActions.push(...(await ensureSubprocesses(target, apply)));
  });

  await withDb(SOURCE_DB, async (source) => {
    await withDb(TARGET_DB, async (target) => {
      allActions.push(...(await ensureOrionFieldsFromSource(source, target, apply)));
    });
  });

  console.log('\n==== ACCIONES ====');
  console.log(JSON.stringify(allActions, null, 2));

  await withDb(TARGET_DB, (p) => inspect(p, `${TARGET_DB} después`));

  if (dry) {
    console.log('\nDry-run listo. Para aplicar: node scripts/sync-orion-schema-to-kronosdb.cjs --apply');
  } else {
    console.log('\nAplicado en KRONOSDB.');
    console.log(
      'Nota: permisos de usuario (subprocess_user_company) no se copian; asígnelos en Administración → Usuarios.'
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
