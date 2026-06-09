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
  const { PrismaClient } = require('../app/generated/prisma');
  const prisma = new PrismaClient();
  const email = process.argv[2] || 'juan.fonseca@gsslatam.com';

  const exact = await prisma.user.findUnique({
    where: { email },
    select: { email: true, role: true, name: true, isActive: true },
  });

  const allAdmins = await prisma.user.findMany({
    where: { role: { in: ['admin', 'super_user'] } },
    select: { email: true, role: true, name: true },
    take: 10,
  });

  console.log('Usuario exacto:', JSON.stringify(exact, null, 2));
  console.log('Admins en KRONOSDB (top 10):', JSON.stringify(allAdmins, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
