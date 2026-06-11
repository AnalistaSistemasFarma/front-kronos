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

  const subprocess = await prisma.subprocessUserCompany.findFirst({
    where: {
      companyUser: { user: { email } },
      subprocess: { subprocess_url: '/process/administration/users' },
    },
    include: {
      subprocess: { select: { subprocess: true, subprocess_url: true } },
    },
  });

  console.log('Subproceso admin usuarios:', JSON.stringify(subprocess, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
