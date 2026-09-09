/**
 * Sembrar subproceso "Firma digital" (permiso de gestión Orion).
 *
 * Uso:
 *   node scripts/seed-firma-manage-subprocess.cjs
 *   node scripts/seed-firma-manage-subprocess.cjs --email=usuario@empresa.com
 *
 * Tras sembrarlo, asígnelo una vez en Administración → Usuarios
 * (el selector pide empresa por el modelo actual; el permiso aplica a la persona).
 */
const fs = require('fs');
const path = require('path');

const FIRMA_URL = '/process/firma/manage';
const FIRMA_NAME = 'Firma digital';

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

async function main() {
  loadEnv();
  const { email } = parseArgs();
  const { PrismaClient } = require('../app/generated/prisma');
  const prisma = new PrismaClient();

  try {
    const db = await prisma.$queryRawUnsafe(`SELECT DB_NAME() AS db`);
    console.log(`Base activa: ${db[0]?.db}`);

    let processId = null;
    const existingProcess = await prisma.$queryRawUnsafe(`
      SELECT TOP 1 id_process FROM [process]
      WHERE process IN (N'Solicitudes', N'Firma digital', N'GSS Firma')
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

    const existing = await prisma.$queryRawUnsafe(`
      SELECT TOP 1 id_subprocess, subprocess
      FROM [subprocess]
      WHERE subprocess_url = N'${FIRMA_URL}'
      ORDER BY id_subprocess
    `);

    let subId = existing[0]?.id_subprocess ?? null;
    if (!subId) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO [subprocess] (subprocess, id_process, subprocess_url)
        VALUES (N'${FIRMA_NAME}', ${Number(processId)}, N'${FIRMA_URL}')
      `);
      const created = await prisma.$queryRawUnsafe(`
        SELECT TOP 1 id_subprocess FROM [subprocess]
        WHERE subprocess_url = N'${FIRMA_URL}'
        ORDER BY id_subprocess DESC
      `);
      subId = created[0]?.id_subprocess;
      console.log(`Creado subproceso "${FIRMA_NAME}" id=${subId}`);
    } else {
      await prisma.$executeRawUnsafe(`
        UPDATE [subprocess]
        SET subprocess = N'${FIRMA_NAME}', id_process = ${Number(processId)}
        WHERE id_subprocess = ${Number(subId)}
      `);
      console.log(`Actualizado subproceso "${FIRMA_NAME}" id=${subId}`);
    }

    if (email) {
      const users = await prisma.$queryRawUnsafe(`
        SELECT TOP 1 id FROM [user]
        WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(N'${email.replace(/'/g, "''")}')))
      `);
      const userId = users[0]?.id;
      if (!userId) {
        console.warn(`Usuario no encontrado: ${email}`);
      } else {
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
            console.log(`Otorgado a ${email} en company_user=${cu.id_company_user} (empresa ${cu.id_company})`);
          } else {
            console.log(`Ya tenía permiso en empresa ${cu.id_company}`);
          }
        }
      }
    } else {
      console.log('Subproceso listo. Asígnalo en Administración → Usuarios (o pasa --email=...).');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
