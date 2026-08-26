/**
 * Crea (o reutiliza) la categoría Farmadosis y los 3 procesos web:
 *   Contacto web | Calidad web | Farmacovigilancia web
 *
 * Cada proceso: campos del catálogo, 1 tarea con responsable, active=1.
 *
 * Uso:
 *   node scripts/seed-farmadosis-workflows.mjs
 *   node scripts/seed-farmadosis-workflows.mjs --email=tu@correo.com
 *   node scripts/seed-farmadosis-workflows.mjs --dry-run
 *
 * Luego pega en .env el FARMADOSIS_PROCESS_MAP y FARMADOSIS_REQUESTER_USER_ID
 * que imprime el script, y reinicia npm run dev.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import sql from 'mssql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outPath = path.join(root, 'scripts', '.farmadosis-seed-result.json');

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) throw new Error('No se encontró .env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function parseArgs() {
  const emailArg = process.argv.find((a) => a.startsWith('--email='));
  return {
    email: emailArg ? emailArg.split('=').slice(1).join('=').trim() : null,
    dryRun: process.argv.includes('--dry-run'),
  };
}

const SELECT_OPTIONS = {
  Sexo: ['Femenino', 'Masculino', 'Otro', 'No especifica'],
  Embarazada: ['Sí', 'No', 'No aplica'],
  'Grupo etario': [
    'Neonato (0–28 días)',
    'Lactante (1–23 meses)',
    'Niño (2–11 años)',
    'Adolescente (12–17 años)',
    'Adulto (18–64 años)',
    'Adulto mayor (65+ años)',
  ],
  'Resultado del evento': [
    'Recuperado / Resuelto',
    'En recuperación / Resolviéndose',
    'No recuperado / No resuelto',
    'Recuperado con secuelas',
    'Fatal',
    'Desconocido',
  ],
  '¿Evento serio?': ['Sí', 'No', 'Desconocido'],
  'Autoriza contacto': ['Sí', 'No'],
  'Acepta política de tratamiento de datos': ['Sí', 'No'],
};

/** @type {{ name: string, formKey: string, fields: { label: string, type: string, required: boolean }[] }[]} */
const PROCESSES = [
  {
    formKey: 'contacto',
    name: 'Contacto web',
    fields: [
      { label: 'Nombre', type: 'text', required: true },
      { label: 'Email', type: 'email', required: true },
      { label: 'Mensaje', type: 'textarea', required: true },
    ],
  },
  {
    formKey: 'calidad',
    name: 'Calidad web',
    fields: [
      { label: 'Nombre', type: 'text', required: false },
      { label: 'País', type: 'text', required: true },
      { label: 'Teléfono o correo de contacto', type: 'text', required: false },
      { label: 'Nombre del producto', type: 'text', required: true },
      { label: 'Número de lote', type: 'text', required: true },
      { label: 'Parte o función del producto afectada', type: 'textarea', required: false },
      { label: 'Descripción', type: 'textarea', required: false },
      { label: '¿Dispone de una muestra para evaluación?', type: 'textarea', required: false },
    ],
  },
  {
    formKey: 'farmacovigilancia',
    name: 'Farmacovigilancia web',
    fields: [
      { label: 'Iniciales', type: 'text', required: true },
      { label: 'Edad', type: 'number', required: true },
      { label: 'Peso (kg)', type: 'number', required: false },
      { label: 'Talla (cm)', type: 'number', required: false },
      { label: 'Grupo etario', type: 'select', required: false },
      { label: 'Sexo', type: 'select', required: true },
      { label: 'Embarazada', type: 'select', required: true },
      { label: 'Descripción', type: 'textarea', required: true },
      { label: 'Fecha del evento', type: 'date', required: true },
      { label: 'Resultado del evento', type: 'select', required: false },
      { label: '¿Evento serio?', type: 'select', required: false },
      { label: 'Medicamentos', type: 'textarea', required: false },
      { label: 'Antecedentes médicos', type: 'textarea', required: false },
      { label: 'Medicamentos concomitantes', type: 'textarea', required: false },
      { label: 'Estudios / exámenes', type: 'textarea', required: false },
      { label: 'Nombre del reportante', type: 'text', required: true },
      { label: 'Profesión', type: 'text', required: false },
      { label: 'Institución', type: 'text', required: false },
      { label: 'Teléfono del reportante', type: 'tel', required: false },
      { label: 'Email del reportante', type: 'email', required: true },
      { label: 'Autoriza contacto', type: 'select', required: true },
      { label: 'Acepta política de tratamiento de datos', type: 'select', required: true },
    ],
  },
];

async function findUser(pool, email) {
  if (email) {
    const r = await pool
      .request()
      .input('email', sql.NVarChar(255), email)
      .query(`SELECT TOP 1 id, name, email, role FROM [user] WHERE LOWER(email) = LOWER(@email)`);
    if (r.recordset[0]) return r.recordset[0];
  }
  const admin = await pool.request().query(`
    SELECT TOP 1 id, name, email, role
    FROM [user]
    WHERE email IS NOT NULL AND (role = 'admin' OR role LIKE '%admin%')
    ORDER BY id
  `);
  if (admin.recordset[0]) return admin.recordset[0];
  const any = await pool.request().query(`
    SELECT TOP 1 id, name, email, role FROM [user] WHERE email IS NOT NULL ORDER BY id
  `);
  return any.recordset[0] || null;
}

async function ensureCategory(pool, companyId, userId, dryRun) {
  const existing = await pool.request().query(`
    SELECT TOP 1 cr.id, cr.category
    FROM category_request cr
    WHERE LOWER(LTRIM(RTRIM(cr.category))) = 'farmadosis'
    ORDER BY cr.id
  `);
  if (existing.recordset[0]) {
    const id = existing.recordset[0].id;
    const link = await pool
      .request()
      .input('cid', sql.Int, id)
      .input('co', sql.Int, companyId)
      .query(`
        SELECT TOP 1 1 AS ok FROM company_category_request
        WHERE id_category_request = @cid AND id_company = @co
      `);
    if (!link.recordset[0] && !dryRun) {
      await pool
        .request()
        .input('cid', sql.Int, id)
        .input('co', sql.Int, companyId)
        .query(`
          INSERT INTO company_category_request (id_category_request, id_company)
          VALUES (@cid, @co)
        `);
    }
    return { id, created: false };
  }
  if (dryRun) return { id: null, created: true };
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const cat = await new sql.Request(tx)
      .input('category', sql.NVarChar(255), 'Farmadosis')
      .query(`INSERT INTO category_request (category) OUTPUT INSERTED.id VALUES (@category)`);
    const id = cat.recordset[0].id;
    await new sql.Request(tx)
      .input('id_category', sql.Int, id)
      .input('id_user', sql.NVarChar(1000), userId)
      .query(`
        INSERT INTO user_category_request_general (id_category, id_user)
        VALUES (@id_category, @id_user)
      `);
    await new sql.Request(tx)
      .input('cid', sql.Int, id)
      .input('co', sql.Int, companyId)
      .query(`
        INSERT INTO company_category_request (id_category_request, id_company)
        VALUES (@cid, @co)
      `);
    await tx.commit();
    return { id, created: true };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function findProcessByName(pool, name) {
  const r = await pool
    .request()
    .input('name', sql.NVarChar(1000), name)
    .query(`
      SELECT TOP 1 id, process, active
      FROM process_category
      WHERE LOWER(LTRIM(RTRIM(process))) = LOWER(@name)
      ORDER BY active DESC, id DESC
    `);
  return r.recordset[0] || null;
}

async function ensureProcess(pool, { categoryId, processDef, userId, dryRun }) {
  const existing = await findProcessByName(pool, processDef.name);
  if (existing) {
    if (!existing.active && !dryRun) {
      await pool
        .request()
        .input('id', sql.Int, existing.id)
        .query(`UPDATE process_category SET active = 1 WHERE id = @id`);
    }
    // Asegurar responsable del proceso
    if (!dryRun) {
      const up = await pool
        .request()
        .input('pid', sql.Int, existing.id)
        .input('uid', sql.NVarChar(1000), userId)
        .query(`
          SELECT TOP 1 1 AS ok FROM user_process_category_request_general
          WHERE id_process_category = @pid AND id_user = @uid
        `);
      if (!up.recordset[0]) {
        await pool
          .request()
          .input('pid', sql.Int, existing.id)
          .input('uid', sql.NVarChar(1000), userId)
          .query(`
            INSERT INTO user_process_category_request_general (id_process_category, id_user)
            VALUES (@pid, @uid)
          `);
      }
    }
    return { id: existing.id, created: false, activated: !existing.active };
  }

  if (dryRun) return { id: null, created: true, activated: true };

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const proc = await new sql.Request(tx)
      .input('process', sql.NVarChar(1000), processDef.name)
      .input('id_category', sql.Int, categoryId)
      .query(`
        INSERT INTO process_category (process, id_category_request, active, id_status)
        OUTPUT INSERTED.id
        VALUES (@process, @id_category, 1, 6)
      `);
    const processId = proc.recordset[0].id;

    await new sql.Request(tx)
      .input('id_process', sql.Int, processId)
      .input('id_user', sql.NVarChar(1000), userId)
      .query(`
        INSERT INTO user_process_category_request_general (id_process_category, id_user)
        VALUES (@id_process, @id_user)
      `);

    const task = await new sql.Request(tx)
      .input('task', sql.NVarChar(1000), `Atender ${processDef.name}`)
      .input('id_process', sql.Int, processId)
      .query(`
        INSERT INTO task_process_category
          (task, id_process_category, active, cost, is_sequential, display_order, is_authorization)
        OUTPUT INSERTED.id
        VALUES (@task, @id_process, 1, 0, 0, 0, 0)
      `);
    const taskId = task.recordset[0].id;

    await new sql.Request(tx)
      .input('id_task', sql.Int, taskId)
      .input('id_user', sql.NVarChar(1000), userId)
      .query(`
        INSERT INTO user_task_request_general (id_task, id_user)
        VALUES (@id_task, @id_user)
      `);

    let order = 0;
    for (const field of processDef.fields) {
      const fieldType = field.type === 'select' ? 'select' : field.type;
      const fr = await new sql.Request(tx)
        .input('id_process', sql.Int, processId)
        .input('field_label', sql.NVarChar(255), field.label)
        .input('field_type', sql.NVarChar(30), fieldType)
        .input('required', sql.Bit, field.required ? 1 : 0)
        .input('display_order', sql.Int, order++)
        .query(`
          INSERT INTO process_form_field
            (id_process_category, field_label, field_type, required, active, display_order)
          OUTPUT INSERTED.id
          VALUES (@id_process, @field_label, @field_type, @required, 1, @display_order)
        `);
      const fieldId = fr.recordset[0].id;
      const options = SELECT_OPTIONS[field.label];
      if (fieldType === 'select' && Array.isArray(options)) {
        let optOrder = 0;
        for (const label of options) {
          await new sql.Request(tx)
            .input('id_form_field', sql.Int, fieldId)
            .input('option_label', sql.NVarChar(255), label)
            .input('display_order', sql.Int, optOrder++)
            .query(`
              INSERT INTO process_form_field_option
                (id_form_field, option_label, active, display_order)
              VALUES (@id_form_field, @option_label, 1, @display_order)
            `);
        }
      }
    }

    await tx.commit();
    return { id: processId, created: true, activated: true };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function main() {
  loadEnv();
  const { email, dryRun } = parseArgs();
  const companyId = Number(process.env.FARMADOSIS_COMPANY_ID || 1);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new Error('FARMADOSIS_COMPANY_ID inválido');
  }

  const dbconfig = (await import(pathToFileURL(path.join(root, 'dbconfig.js')).href)).default;
  const cfg =
    typeof dbconfig.buildMssqlConfig === 'function'
      ? dbconfig.buildMssqlConfig()
      : dbconfig;

  const pool = await sql.connect(cfg);
  try {
    const company = await pool
      .request()
      .input('id', sql.Int, companyId)
      .query(`SELECT id_company, company FROM company WHERE id_company = @id`);
    if (!company.recordset[0]) {
      throw new Error(`No existe company id=${companyId}. Ajusta FARMADOSIS_COMPANY_ID.`);
    }

    const user = await findUser(pool, email);
    if (!user?.id) {
      throw new Error(
        'No hay usuario en [user] para asignar. Pasa --email=... de un usuario SynerLink.'
      );
    }

    console.log(dryRun ? '=== DRY RUN ===' : '=== SEED Farmadosis ===');
    console.log(`Empresa: ${company.recordset[0].company} (id=${companyId})`);
    console.log(`Responsable / requester: ${user.name} <${user.email}> id=${user.id}`);

    const category = await ensureCategory(pool, companyId, user.id, dryRun);
    console.log(
      `Categoría Farmadosis: ${category.created ? 'creada' : 'existente'} id=${category.id}`
    );

    const processMap = {};
    const details = [];
    for (const processDef of PROCESSES) {
      const result = await ensureProcess(pool, {
        categoryId: category.id,
        processDef,
        userId: user.id,
        dryRun,
      });
      processMap[processDef.formKey] = result.id;
      details.push({
        formKey: processDef.formKey,
        name: processDef.name,
        ...result,
      });
      console.log(
        `Proceso "${processDef.name}": ${result.created ? 'creado' : 'existente'} id=${result.id}` +
          (result.activated && !result.created ? ' (activado)' : '')
      );
    }

    const envSnippet = [
      `FARMADOSIS_COMPANY_ID=${companyId}`,
      `FARMADOSIS_REQUESTER_USER_ID=${user.id}`,
      `FARMADOSIS_PROCESS_MAP=${JSON.stringify(processMap)}`,
    ].join('\n');

    console.log('\n=== Pega esto en .env (y reinicia npm run dev) ===\n');
    console.log(envSnippet);

    const payload = {
      companyId,
      requesterUserId: user.id,
      requesterEmail: user.email,
      processMap,
      details,
      envSnippet,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\nResultado guardado en ${outPath}`);
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err);
  try {
    fs.writeFileSync(outPath, JSON.stringify({ error: String(err) }, null, 2));
  } catch {
    /* ignore */
  }
  process.exit(1);
});
