const fs = require('fs');
const path = require('path');

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const envPath = path.resolve(__dirname, '..', name);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) {
        process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
    break;
  }
}

loadEnv();

async function main() {
  const { resolveConnection } = require('../dbconfig');
  const { PrismaClient } = require('../app/generated/prisma');

  const configured = resolveConnection();
  console.log('Configurado (.env):', `${configured.server}/${configured.database}`);

  const prisma = new PrismaClient();
  const prismaRows = await prisma.$queryRawUnsafe('SELECT DB_NAME() AS db');
  console.log('Prisma conectado a:', prismaRows[0]?.db);
  await prisma.$disconnect();

  // mssql via dynamic import if ts fails, use buildMssqlConfig directly
  const sql = require('mssql');
  const { buildMssqlConfig } = require('../dbconfig');
  const pool = await sql.connect(buildMssqlConfig());
  const mssqlRows = await pool.request().query('SELECT DB_NAME() AS db');
  console.log('mssql conectado a:', mssqlRows.recordset[0]?.db);
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
