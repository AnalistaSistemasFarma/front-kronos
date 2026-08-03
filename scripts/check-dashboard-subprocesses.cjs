const fs = require('fs');
const path = require('path');
const envPath = path.resolve(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const { PrismaClient } = require('../app/generated/prisma');
const prisma = new PrismaClient();

async function main() {
  const db = await prisma.$queryRawUnsafe('SELECT DB_NAME() AS db');
  console.log('DB:', db[0]?.db);
  const rows = await prisma.$queryRawUnsafe(`
    SELECT s.id_subprocess, s.subprocess, s.subprocess_url, p.process
    FROM subprocess s
    LEFT JOIN process p ON p.id_process = s.id_process
    WHERE s.subprocess LIKE N'%Dashboard%' OR s.subprocess_url LIKE N'%dashboard%'
    ORDER BY s.subprocess
  `);
  console.log('Dashboards:', JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
