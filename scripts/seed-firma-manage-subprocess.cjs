/**
 * Sembrar subprocesos Orion:
 * - Preparar firma (/process/firma/prepare) — gestiona PDF / firmantes / enviar
 * - Firmar documento (/process/firma/sign) — obligatorio para poder firmar
 *
 * Migra el legacy /process/firma/manage (“Firma digital”) → Preparar firma.
 *
 * Uso:
 *   node scripts/seed-firma-manage-subprocess.cjs
 *   node scripts/seed-firma-manage-subprocess.cjs --email=usuario@empresa.com
 *   node scripts/seed-firma-manage-subprocess.cjs --email=x@y.com --also-sign
 */
const fs = require('fs');
const path = require('path');

const PREPARE_URL = '/process/firma/prepare';
const PREPARE_NAME = 'Preparar firma';
const SIGN_URL = '/process/firma/sign';
const SIGN_NAME = 'Firmar documento';
const LEGACY_MANAGE_URL = '/process/firma/manage';

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('No se encontró .env');
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function parseArgs() {
  const emailArg = process.argv.find((a) => a.startsWith('--email='));
  return {
    email: emailArg ? emailArg.split('=').slice(1).join('=').trim() : null,
    alsoSign: process.argv.includes('--also-sign'),
  };
}

async function ensureSubprocess(prisma, processId, name, url) {
  const existing = await prisma.$queryRawUnsafe(`
    SELECT TOP 1 id_subprocess, subprocess, subprocess_url
    FROM [subprocess]
    WHERE subprocess_url = N'${url.replace(/'/g, "''")}'
    ORDER BY id_subprocess
  `);

  let subId = existing[0]?.id_subprocess ?? null;
  if (!subId) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO [subprocess] (subprocess, id_process, subprocess_url)
      VALUES (N'${name.replace(/'/g, "''")}', ${Number(processId)}, N'${url.replace(/'/g, "''")}')
    `);
    const created = await prisma.$queryRawUnsafe(`
      SELECT TOP 1 id_subprocess FROM [subprocess]
      WHERE subprocess_url = N'${url.replace(/'/g, "''")}'
      ORDER BY id_subprocess DESC
    `);
    subId = created[0]?.id_subprocess;
    console.log(`Creado subproceso "${name}" id=${subId} url=${url}`);
  } else {
    await prisma.$executeRawUnsafe(`
      UPDATE [subprocess]
      SET subprocess = N'${name.replace(/'/g, "''")}', id_process = ${Number(processId)}
      WHERE id_subprocess = ${Number(subId)}
    `);
    console.log(`Actualizado subproceso "${name}" id=${subId}`);
  }
  return Number(subId);
}

async function grantToUser(prisma, subId, email) {
  const users = await prisma.$queryRawUnsafe(`
    SELECT TOP 1 id FROM [user]
    WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(N'${email.replace(/'/g, "''")}')))
  `);
  const userId = users[0]?.id;
  if (!userId) {
    console.warn(`Usuario no encontrado: ${email}`);
    return;
  }
  const companies = await prisma.$queryRawUnsafe(`
    SELECT id_company_user, id_company
    FROM [company_user]
    WHERE id_user = N'${String(userId).replace(/'/g, "''")}'
  `);
  for (const cu of companies) {
    const exists = await prisma.$queryRawUnsafe(`
      SELECT TOP 1 id_subprocess_user_company AS id
      FROM [subprocess_user_company]
      WHERE id_company_user = ${Number(cu.id_company_user)}
        AND id_subprocess = ${Number(subId)}
    `);
    if (!exists[0]?.id) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO [subprocess_user_company] (id_subprocess, id_company_user)
        VALUES (${Number(subId)}, ${Number(cu.id_company_user)})
      `);
      console.log(
        `Otorgado subprocess=${subId} a ${email} en company_user=${cu.id_company_user} (empresa ${cu.id_company})`
      );
    } else {
      console.log(`Ya tenía subprocess=${subId} en empresa ${cu.id_company}`);
    }
  }
}

async function main() {
  loadEnv();
  const { email, alsoSign } = parseArgs();
  const { PrismaClient } = require('../app/generated/prisma');
  const prisma = new PrismaClient();

  try {
    const db = await prisma.$queryRawUnsafe(`SELECT DB_NAME() AS db`);
    console.log(`Base activa: ${db[0]?.db}`);

    let processId = null;
    const existingProcess = await prisma.$queryRawUnsafe(`
      SELECT TOP 1 id_process FROM [process]
      WHERE process IN (N'Solicitudes', N'Firma digital', N'GSS Firma', N'Preparar firma')
      ORDER BY CASE process WHEN N'Solicitudes' THEN 0 ELSE 1 END, id_process
    `);
    processId = existingProcess[0]?.id_process ?? null;

    if (!processId) {
      await prisma.$executeRawUnsafe(`INSERT INTO [process] (process) VALUES (N'Solicitudes')`);
      const created = await prisma.$queryRawUnsafe(`
        SELECT TOP 1 id_process FROM [process] WHERE process = N'Solicitudes' ORDER BY id_process DESC
      `);
      processId = created[0]?.id_process;
    }

    console.log(`Proceso padre id=${processId}`);

    // Migrar legacy manage → prepare (misma fila, nueva URL/nombre)
    const legacy = await prisma.$queryRawUnsafe(`
      SELECT TOP 1 id_subprocess
      FROM [subprocess]
      WHERE subprocess_url = N'${LEGACY_MANAGE_URL}'
      ORDER BY id_subprocess
    `);
    if (legacy[0]?.id_subprocess) {
      const prepareExists = await prisma.$queryRawUnsafe(`
        SELECT TOP 1 id_subprocess FROM [subprocess]
        WHERE subprocess_url = N'${PREPARE_URL}'
      `);
      if (!prepareExists[0]?.id_subprocess) {
        await prisma.$executeRawUnsafe(`
          UPDATE [subprocess]
          SET subprocess = N'${PREPARE_NAME}',
              subprocess_url = N'${PREPARE_URL}',
              id_process = ${Number(processId)}
          WHERE id_subprocess = ${Number(legacy[0].id_subprocess)}
        `);
        console.log(
          `Migrado legacy manage id=${legacy[0].id_subprocess} → ${PREPARE_NAME} (${PREPARE_URL})`
        );
      } else {
        console.log(
          `Ya existe prepare; legacy manage id=${legacy[0].id_subprocess} se deja (alias en código).`
        );
      }
    }

    const prepareId = await ensureSubprocess(prisma, processId, PREPARE_NAME, PREPARE_URL);
    const signId = await ensureSubprocess(prisma, processId, SIGN_NAME, SIGN_URL);

    if (email) {
      await grantToUser(prisma, prepareId, email);
      if (alsoSign) {
        await grantToUser(prisma, signId, email);
      } else {
        console.log('Tip: añada --also-sign para otorgar también “Firmar documento”.');
      }
    } else {
      console.log(
        'Subprocesos listos. Asígnalos en Administración → Usuarios (o pasa --email=... [--also-sign]).'
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
