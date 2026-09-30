/**
 * Sembrar subproceso “Dosis de Amor y Amistad” (OLP / San Valentín)
 * URL: /process/valentine-wall
 *
 * Uso:
 *   node scripts/seed-valentine-wall-subprocess.cjs
 *   node scripts/seed-valentine-wall-subprocess.cjs --email=usuario@empresa.com
 *
 * Luego asígnalo en Administración → Usuarios (solo a personal OLP).
 */
const fs = require('fs');
const path = require('path');

const URL = '/process/valentine-wall';
const NAME = 'Dosis de Amor y Amistad';

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
  const { email } = parseArgs();
  const { PrismaClient } = require('../app/generated/prisma');
  const prisma = new PrismaClient();

  try {
    const db = await prisma.$queryRawUnsafe(`SELECT DB_NAME() AS db`);
    console.log(`Base activa: ${db[0]?.db}`);

    let processId = null;
    // Preferir Administración (junto a otros permisos del hub) para que salga claro en Asignar Subprocesos
    const existingProcess = await prisma.$queryRawUnsafe(`
      SELECT TOP 1 id_process FROM [process]
      WHERE process IN (N'Administración', N'Solicitudes', N'Campañas', N'OLP')
      ORDER BY CASE process
        WHEN N'Administración' THEN 0
        WHEN N'Solicitudes' THEN 1
        ELSE 2 END, id_process
    `);
    processId = existingProcess[0]?.id_process ?? null;

    if (!processId) {
      await prisma.$executeRawUnsafe(`INSERT INTO [process] (process) VALUES (N'Administración')`);
      const created = await prisma.$queryRawUnsafe(`
        SELECT TOP 1 id_process FROM [process] WHERE process = N'Administración' ORDER BY id_process DESC
      `);
      processId = created[0]?.id_process;
    }

    console.log(`Proceso padre id=${processId}`);
    const subId = await ensureSubprocess(prisma, processId, NAME, URL);

    if (email) {
      await grantToUser(prisma, subId, email);
    } else {
      console.log(
        'Subproceso listo. Asígnarlo en Administración → Usuarios solo a personal OLP (o --email=...).'
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
