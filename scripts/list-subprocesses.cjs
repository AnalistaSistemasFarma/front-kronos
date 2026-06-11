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

  const subs = await prisma.subprocess.findMany({
    where: {
      OR: [
        { subprocess_url: { contains: 'dashboard' } },
        { subprocess: { contains: 'Dashboard' } },
        { subprocess_url: { contains: 'administration' } },
      ],
    },
    select: { id_subprocess: true, subprocess: true, subprocess_url: true },
  });

  console.log(JSON.stringify(subs, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
