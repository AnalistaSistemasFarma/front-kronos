/**
 * Diagnóstico + crear auth pendiente para firmante Orion.
 * node scripts/ensure-orion-pending-auth.cjs --requestId=2133
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function isCompleted(status, signedAt) {
  const v = String(status || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (['FIRMADO', 'SIGNED', 'COMPLETED', 'DONE', 'APPLIED'].includes(v)) return true;
  return Boolean(String(signedAt || '').trim());
}

function getPending(signers) {
  const list = [...(signers || [])]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.order ?? a.i + 1) - (b.s.order ?? b.i + 1) || a.i - b.i)
    .map(({ s }) => s);
  for (const s of list) {
    const st = String(s.status || '').toUpperCase();
    if (['RECHAZADO', 'REJECTED'].includes(st)) continue;
    if (!isCompleted(s.status, s.signedAt)) return s;
  }
  return null;
}

async function main() {
  loadEnv();
  const requestId = Number(
    (process.argv.find((a) => a.startsWith('--requestId=')) || '').split('=')[1] || 2133
  );
  const fileIdArg = (process.argv.find((a) => a.startsWith('--fileId=')) || '').split('=')[1] || null;

  const pool = await sql.connect({
    server: process.env.SAPSENDSQL_SERVER,
    database: process.env.SAPSENDSQL_BD,
    user: process.env.SAPSENDSQL_USER,
    password: process.env.SAPSENDSQL_PASS,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const fieldRes = await pool
    .request()
    .input('id', sql.Int, requestId)
    .input('fieldType', sql.NVarChar(30), 'orion_signature')
    .query(`
      SELECT TOP 1 pff.id AS id_form_field, rfv.value_text
      FROM process_category_request_general pcr
      INNER JOIN process_form_field pff ON pff.id_process_category = pcr.id_process_category
      LEFT JOIN request_form_value rfv
        ON rfv.id_form_field = pff.id AND rfv.id_request_general = @id
      WHERE pcr.id_request_general = @id AND pff.field_type = @fieldType AND pff.active = 1
      ORDER BY pff.display_order, pff.id
    `);

  const bag = JSON.parse(fieldRes.recordset[0]?.value_text || '{}');
  const documents = bag.documents || {};
  const fileId =
    (fileIdArg && documents[fileIdArg] ? fileIdArg : null) ||
    Object.keys(documents).find((fid) => getPending(documents[fid]?.signers)) ||
    Object.keys(documents)[0];
  const state = documents[fileId] || {};
  const pending = getPending(state.signers);
  if (!pending?.email) {
    console.log('Sin firmante pendiente. Signers:', state.signers);
    await pool.close();
    return;
  }

  const email = String(pending.email).trim().toLowerCase();
  console.log('Pendiente:', { email, order: pending.order, name: pending.name, fileId });

  const userRes = await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .query(`SELECT TOP 1 id, email, name FROM [user] WHERE LOWER(LTRIM(RTRIM(email))) = @email`);
  const user = userRes.recordset[0];
  if (!user) throw new Error('Usuario no encontrado: ' + email);
  console.log('Usuario:', user);

  const allTasks = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT trg.id, trg.id_status, CAST(trg.id_assigned AS NVARCHAR(255)) AS id_assigned,
           trg.resolution, tpc.task, tpc.is_authorization, tpc.id AS template_id,
           tp.type_authorization, u.email AS assigned_email
    FROM task_request_general trg
    INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
    LEFT JOIN types_authorization tp ON tp.id = tpc.type_authorization
    LEFT JOIN [user] u ON CAST(u.id AS NVARCHAR(255)) = CAST(trg.id_assigned AS NVARCHAR(255))
    WHERE trg.id_request_general = @id
    ORDER BY trg.id DESC
  `);
  console.log('Tareas solicitud:');
  for (const t of allTasks.recordset) {
    console.log(
      `  #${t.id} status=${t.id_status} auth=${t.is_authorization} assigned=${t.assigned_email || t.id_assigned} :: ${(t.resolution || '').slice(0, 120)}`
    );
  }

  const openAuth = allTasks.recordset.filter(
    (t) =>
      Number(t.is_authorization) === 1 &&
      ![2, 3].includes(Number(t.id_status)) &&
      String(t.id_assigned) === String(user.id) &&
      String(t.resolution || '').includes('[orionAuth]')
  );
  console.log('Auth abiertas del firmante:', openAuth.map((t) => t.id));

  let taskId = openAuth[0]?.id || null;

  if (!taskId) {
    // Buscar plantilla FIRMA (misma lógica aproximada que signerAuthorizations)
    const tpl = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT TOP 1 tpc.id, tpc.task, tp.type_authorization
    FROM process_category_request_general pcrg
    INNER JOIN task_process_category tpc ON tpc.id_process_category = pcrg.id_process_category
    LEFT JOIN types_authorization tp ON tp.id = tpc.type_authorization
    WHERE pcrg.id_request_general = @id
      AND tpc.is_authorization = 1
      AND (
        LOWER(ISNULL(tp.type_authorization,'')) LIKE N'%firma%'
        OR LOWER(tpc.task) LIKE N'%firma%'
        OR LOWER(tpc.task) LIKE N'%autorizaci%'
      )
    ORDER BY
      CASE WHEN LOWER(tpc.task) LIKE N'%previa%' THEN 1 ELSE 0 END,
      CASE WHEN ISNULL(tpc.is_sequential, 0) = 0 THEN 0 ELSE 1 END,
      tpc.id
  `);
    const template = tpl.recordset[0];
    if (!template) throw new Error('No hay plantilla de autorización FIRMA en el proceso');
    console.log('Plantilla:', template);

    const resolution = `[orionFile:${fileId}][orionAuth] Autorizar firma${
      state.fileName ? `: ${state.fileName}` : ''
    } (${email})`;

    const inserted = await pool
      .request()
      .input('id_request', sql.Int, requestId)
      .input('id_task', sql.Int, template.id)
      .input('id_user', sql.NVarChar(255), String(user.id))
      .input('resolution', sql.NVarChar(sql.MAX), resolution)
      .query(`
      INSERT INTO task_request_general
      (id_request_general, id_task, id_status, id_assigned, resolution)
      OUTPUT INSERTED.id
      VALUES (@id_request, @id_task, 4, @id_user, @resolution)
    `);

    taskId = inserted.recordset[0]?.id;
    console.log('Creada autorización id=', taskId);

    const subjectRes = await pool
      .request()
      .input('id', sql.Int, requestId)
      .query(`SELECT TOP 1 subject_request FROM requests_general WHERE id = @id`);
    const subject = subjectRes.recordset[0]?.subject_request || null;

    await pool
      .request()
      .input('email', sql.NVarChar(255), email)
      .input('title', sql.NVarChar(255), 'Autorizar firma · SynerLink')
      .input(
        'body',
        sql.NVarChar(sql.MAX),
        `Solicitud #${requestId}${state.fileName ? ` · ${state.fileName}` : ''}${
          subject ? ` — ${subject}` : ''
        }. Autorice para ver y firmar el documento.`
      )
      .input('url', sql.NVarChar(500), '/process/authorization')
      .query(`
      INSERT INTO notifications (email, title, body, url)
      VALUES (@email, @title, @body, @url)
    `);
    console.log('Notificación campana creada');
  } else {
    console.log('Ya hay autorización abierta id=', taskId);
  }

  // Cerrar tareas de firma abiertas de firmantes ya completados
  for (const s of state.signers || []) {
    if (!isCompleted(s.status, s.signedAt)) continue;
    const em = String(s.email || '')
      .trim()
      .toLowerCase();
    if (!em) continue;
    const uDone = await pool
      .request()
      .input('email', sql.NVarChar(255), em)
      .query(
        `SELECT TOP 1 id FROM [user] WHERE LOWER(LTRIM(RTRIM(email))) = @email`
      );
    const doneId = uDone.recordset[0]?.id;
    if (!doneId) continue;
    const openFirma = await pool
      .request()
      .input('id', sql.Int, requestId)
      .input('uid', sql.NVarChar(255), String(doneId))
      .input('needle', sql.NVarChar(400), `[orionFile:${fileId}]`)
      .query(`
        SELECT trg.id, trg.resolution
        FROM task_request_general trg
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        WHERE trg.id_request_general = @id
          AND trg.id_assigned = @uid
          AND trg.id_status NOT IN (2, 3)
          AND ISNULL(tpc.is_authorization, 0) = 0
          AND CHARINDEX(@needle, ISNULL(trg.resolution, N'')) > 0
      `);
    for (const row of openFirma.recordset) {
      await pool
        .request()
        .input('tid', sql.Int, row.id)
        .input('uid', sql.NVarChar(255), String(doneId))
        .input(
          'resolution',
          sql.NVarChar(sql.MAX),
          `[orionFile:${fileId}] Firma completada por ${s.name || em}.`
        )
        .query(`
          UPDATE task_request_general
          SET id_status = 2, end_date = GETDATE(), date_resolution = GETDATE(),
              id_executor_final = @uid, resolution = @resolution
          WHERE id = @tid AND id_status NOT IN (2, 3)
        `);
      console.log('Cerrada tarea firma obsoleta id=', row.id, 'de', em);
    }
  }

  // También abrir tarea de firma (Tareas asignadas) si no existe
  const firmaTpl = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT TOP 1 tpc.id, tpc.task
    FROM process_category_request_general pcrg
    INNER JOIN task_process_category tpc ON tpc.id_process_category = pcrg.id_process_category
    WHERE pcrg.id_request_general = @id
      AND ISNULL(tpc.is_authorization, 0) = 0
      AND (
        LOWER(tpc.task) LIKE N'%firma%'
        OR LOWER(tpc.task) LIKE N'%firmar%'
        OR LOWER(tpc.task) LIKE N'%documento%'
      )
    ORDER BY tpc.id
  `);
  const firmaTemplate = firmaTpl.recordset[0];
  if (firmaTemplate) {
    const existingFirma = await pool
      .request()
      .input('id', sql.Int, requestId)
      .input('tid', sql.Int, firmaTemplate.id)
      .input('uid', sql.NVarChar(255), String(user.id))
      .input('needle', sql.NVarChar(400), `[orionFile:${fileId}]`)
      .query(`
        SELECT TOP 1 id FROM task_request_general
        WHERE id_request_general = @id AND id_task = @tid AND id_assigned = @uid
          AND id_status NOT IN (2, 3)
          AND CHARINDEX(@needle, ISNULL(resolution, N'')) > 0
      `);
    if (!existingFirma.recordset[0]) {
      const firmaRes = `[orionFile:${fileId}] Pendiente de firma${
        state.fileName ? `: ${state.fileName}` : ''
      }`;
      const insF = await pool
        .request()
        .input('id_request', sql.Int, requestId)
        .input('id_task', sql.Int, firmaTemplate.id)
        .input('id_user', sql.NVarChar(255), String(user.id))
        .input('resolution', sql.NVarChar(sql.MAX), firmaRes)
        .query(`
          INSERT INTO task_request_general
          (id_request_general, id_task, id_status, id_assigned, resolution)
          OUTPUT INSERTED.id
          VALUES (@id_request, @id_task, 4, @id_user, @resolution)
        `);
      console.log('Creada tarea de firma id=', insF.recordset[0]?.id, 'template=', firmaTemplate.task);
    } else {
      console.log('Ya tiene tarea de firma abierta id=', existingFirma.recordset[0].id);
    }
  } else {
    console.log('No se encontró plantilla de tarea de firma (no auth)');
  }

  await pool.close();
}

main().catch(async (e) => {
  console.error('ERROR:', e.message || e);
  try {
    await sql.close();
  } catch (_) {}
  process.exit(1);
});
