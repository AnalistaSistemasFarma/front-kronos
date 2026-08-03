/**
 * Sembrar subprocesos Dashboard Solicitante / Solicitado.
 *
 * Uso:
 *   node scripts/seed-dashboard-solicitante-solicitado.cjs
 *   node scripts/seed-dashboard-solicitante-solicitado.cjs --email=juan.fonseca@gsslatam.com
 */
const fs = require('fs');
const path = require('path');

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
    email: emailArg ? emailArg.split('=').slice(1).join('=').trim() : 'automatizacion@gsslatam.com',
  };
}

async function main() {
  loadEnv();
  const { email } = parseArgs();

  const { PrismaClient } = require('../app/generated/prisma');
  const prisma = new PrismaClient();

  const db = await prisma.$queryRawUnsafe(`SELECT DB_NAME() AS db`);
  console.log(`Base activa: ${db[0]?.db}`);
  console.log(`Otorgando permisos a: ${email}`);

  const processName = 'Solicitudes';
  const items = [
    {
      name: 'Dashboard Solicitante',
      url: '/process/request-general/dashboard-solicitante',
    },
    {
      name: 'Dashboard Solicitado',
      url: '/process/request-general/dashboard-solicitado',
    },
  ];

  let processId = null;
  const existingProcess = await prisma.$queryRawUnsafe(`
    SELECT TOP 1 id_process FROM [process] WHERE process = N'Solicitudes' ORDER BY id_process
  `);
  processId = existingProcess[0]?.id_process ?? null;

  if (!processId) {
    await prisma.$executeRawUnsafe(`INSERT INTO [process] (process) VALUES (N'Solicitudes')`);
    const created = await prisma.$queryRawUnsafe(`
      SELECT TOP 1 id_process FROM [process] WHERE process = N'Solicitudes' ORDER BY id_process DESC
    `);
    processId = created[0]?.id_process;
  }

  console.log(`Proceso Solicitudes id=${processId}`);

  for (const item of items) {
    const existing = await prisma.$queryRawUnsafe(`
      SELECT TOP 1 id_subprocess, subprocess
      FROM [subprocess]
      WHERE subprocess_url = N'${item.url.replace(/'/g, "''")}'
      ORDER BY id_subprocess
    `);

    let subId = existing[0]?.id_subprocess ?? null;
    if (!subId) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO [subprocess] (subprocess, id_process, subprocess_url)
        VALUES (N'${item.name.replace(/'/g, "''")}', ${Number(processId)}, N'${item.url.replace(/'/g, "''")}')
      `);
      const created = await prisma.$queryRawUnsafe(`
        SELECT TOP 1 id_subprocess
        FROM [subprocess]
        WHERE subprocess_url = N'${item.url.replace(/'/g, "''")}'
        ORDER BY id_subprocess DESC
      `);
      subId = created[0]?.id_subprocess;
      console.log(`Creado subproceso ${item.name} id=${subId}`);
    } else {
      await prisma.$executeRawUnsafe(`
        UPDATE [subprocess]
        SET subprocess = N'${item.name.replace(/'/g, "''")}', id_process = ${Number(processId)}
        WHERE id_subprocess = ${Number(subId)}
      `);
      console.log(`Actualizado subproceso ${item.name} id=${subId}`);
    }

    const granted = await prisma.$executeRawUnsafe(`
      INSERT INTO [subprocess_user_company] (id_subprocess, id_company_user)
      SELECT ${Number(subId)}, cu.id_company_user
      FROM [company_user] cu
      JOIN [user] u ON u.id = cu.id_user
      WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(N'${email.replace(/'/g, "''")}')))
        AND NOT EXISTS (
          SELECT 1 FROM [subprocess_user_company] suc
          WHERE suc.id_subprocess = ${Number(subId)}
            AND suc.id_company_user = cu.id_company_user
        )
    `);
    console.log(`Asignaciones nuevas para ${item.name}:`, granted);
  }

  const summary = await prisma.$queryRawUnsafe(`
    SELECT u.email, c.company, s.subprocess, s.subprocess_url
    FROM [subprocess_user_company] suc
    JOIN [subprocess] s ON s.id_subprocess = suc.id_subprocess
    JOIN [company_user] cu ON cu.id_company_user = suc.id_company_user
    JOIN [user] u ON u.id = cu.id_user
    JOIN [company] c ON c.id_company = cu.id_company
    WHERE s.subprocess_url IN (
      N'/process/request-general/dashboard-solicitante',
      N'/process/request-general/dashboard-solicitado'
    )
      AND LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(N'${email.replace(/'/g, "''")}')))
    ORDER BY s.subprocess, c.company
  `);

  console.log('\nPermisos del usuario:');
  console.table(summary);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Error:', error.message || error);
  process.exit(1);
});
