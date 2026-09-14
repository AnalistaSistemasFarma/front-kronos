/**
 * One-shot: reenvía notificación al firmante pendiente de un PDF Orion.
 *
 * Uso:
 *   node scripts/resend-orion-pending-signer-notify.cjs --requestId=2133
 *   node scripts/resend-orion-pending-signer-notify.cjs --requestId=2133 --fileId=01A7...
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) throw new Error('No se encontró .env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || !String(process.env[key] || '').trim()) {
      process.env[key] = value;
    }
  }
}

function parseArgs() {
  const get = (name) => {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=').trim() : null;
  };
  return {
    requestId: Number(get('requestId') || '2133'),
    fileId: get('fileId') || null,
  };
}

function isCompleted(status, signedAt) {
  const v = String(status || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (['FIRMADO', 'SIGNED', 'COMPLETED', 'DONE', 'APPLIED'].includes(v)) return true;
  return Boolean(String(signedAt || '').trim());
}

function orderedSigners(signers) {
  return [...(signers || [])]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const oa = a.s.order ?? a.i + 1;
      const ob = b.s.order ?? b.i + 1;
      if (oa !== ob) return oa - ob;
      return a.i - b.i;
    })
    .map(({ s }) => s);
}

function getPending(signers) {
  for (const s of orderedSigners(signers)) {
    const st = String(s.status || '').toUpperCase();
    if (['RECHAZADO', 'REJECTED'].includes(st)) continue;
    if (!isCompleted(s.status, s.signedAt)) return s;
  }
  return null;
}

async function main() {
  loadEnv();
  const { requestId, fileId: fileIdArg } = parseArgs();
  if (!Number.isFinite(requestId) || requestId <= 0) {
    throw new Error('requestId inválido');
  }

  const config = {
    server: process.env.SAPSENDSQL_SERVER,
    database: process.env.SAPSENDSQL_BD,
    user: process.env.SAPSENDSQL_USER,
    password: process.env.SAPSENDSQL_PASS,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  };

  const pool = await sql.connect(config);

  const fieldRes = await pool
    .request()
    .input('id', sql.Int, requestId)
    .input('fieldType', sql.NVarChar(30), 'orion_signature')
    .query(`
      SELECT TOP 1
        pff.id AS id_form_field,
        rfv.id AS rfv_id,
        rfv.value_text
      FROM process_category_request_general pcr
      INNER JOIN process_form_field pff ON pff.id_process_category = pcr.id_process_category
      LEFT JOIN request_form_value rfv
        ON rfv.id_form_field = pff.id AND rfv.id_request_general = @id
      WHERE pcr.id_request_general = @id
        AND pff.field_type = @fieldType
        AND pff.active = 1
      ORDER BY pff.display_order, pff.id
    `);

  const row = fieldRes.recordset[0];
  if (!row?.value_text) {
    throw new Error(`No hay value_text Orion para solicitud ${requestId}`);
  }

  let bag;
  try {
    bag = JSON.parse(row.value_text);
  } catch {
    throw new Error('value_text Orion no es JSON válido');
  }

  const documents = bag.documents && typeof bag.documents === 'object' ? bag.documents : {};
  const fileIds = Object.keys(documents);
  if (fileIds.length === 0) {
    throw new Error('No hay documents en el bag Orion');
  }

  const fileId =
    (fileIdArg && documents[fileIdArg] ? fileIdArg : null) ||
    fileIds.find((fid) => getPending(documents[fid]?.signers)) ||
    fileIds[0];

  const state = documents[fileId] || {};
  const pending = getPending(state.signers);
  if (!pending?.email) {
    console.log('Estado firmantes:', JSON.stringify(state.signers, null, 2));
    throw new Error(`No hay firmante pendiente en fileId=${fileId}`);
  }

  const email = String(pending.email).trim().toLowerCase();
  const fileName = state.fileName || null;

  const subjectRes = await pool.request().input('id', sql.Int, requestId).query(`
    SELECT TOP 1 subject_request FROM requests_general WHERE id = @id
  `);
  const subject = subjectRes.recordset[0]?.subject_request || null;

  const userRes = await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .query(`
      SELECT TOP 1 id, email FROM [user]
      WHERE LOWER(LTRIM(RTRIM(email))) = @email
    `);
  const user = userRes.recordset[0];
  if (!user?.id) {
    throw new Error(`Firmante sin usuario SynerLink: ${email}`);
  }

  const title = 'Su turno de firma · SynerLink';
  const body = `Solicitud #${requestId}${fileName ? ` · ${fileName}` : ''}${
    subject ? ` — ${subject}` : ''
  }. Ya puede autorizar y firmar el documento.`;
  const url = '/process/authorization';

  await pool
    .request()
    .input('email', sql.NVarChar(255), email)
    .input('title', sql.NVarChar(255), title)
    .input('body', sql.NVarChar(sql.MAX), body)
    .input('url', sql.NVarChar(500), url)
    .query(`
      INSERT INTO notifications (email, title, body, url)
      VALUES (@email, @title, @body, @url)
    `);

  console.log('OK notificación en campana →', email);
  console.log({
    requestId,
    fileId,
    pending: {
      email,
      name: pending.name || null,
      order: pending.order ?? null,
      status: pending.status || null,
    },
    subject,
    fileName,
  });

  // Push best-effort (si VAPID y suscripción existen)
  try {
    const webpush = require('web-push');
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    let contact = (process.env.VAPID_CONTACT_EMAIL || 'mailto:soporte@kronos.local').trim();
    if (contact && !/^mailto:/i.test(contact) && !/^https?:\/\//i.test(contact)) {
      contact = `mailto:${contact}`;
    }
    if (publicKey && privateKey) {
      webpush.setVapidDetails(contact, publicKey, privateKey);
      const subs = await pool
        .request()
        .input('email', sql.NVarChar(255), email)
        .query(
          `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE LOWER(email) = @email`
        );
      let pushed = 0;
      const message = JSON.stringify({ title, body, url, tag: `orion-resend-${requestId}` });
      for (const sub of subs.recordset) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            message
          );
          pushed += 1;
        } catch (err) {
          console.warn('Push sub falló:', err?.statusCode || err?.message || err);
        }
      }
      console.log(
        pushed > 0
          ? `OK push enviado (${pushed})`
          : 'Push no enviado (sin suscripción activa para ese email)'
      );
    } else {
      console.log('Push omitido: faltan VAPID');
    }
  } catch (err) {
    console.warn('Push omitido:', err instanceof Error ? err.message : err);
  }

  await pool.close();
}

main().catch(async (err) => {
  console.error('ERROR:', err instanceof Error ? err.message : err);
  try {
    await sql.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
