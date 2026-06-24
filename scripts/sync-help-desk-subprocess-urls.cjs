/**
 * Alinea subprocess_url en BD con las rutas que ya usa la aplicación
 * (lib/help-desk/subprocessRoles.ts). No cambia la lógica de la app.
 *
 * ADVERTENCIA: escribe en la BD apuntada por DATABASE_URL (.env).
 * Ejecutar manualmente; no está cableado a CI. Revisar entorno antes de correr.
 *
 * Uso: node scripts/sync-help-desk-subprocess-urls.cjs
 */
const fs = require('fs');
const path = require('path');

const OPERATOR_URL = '/process/help-desk/create-ticket';
const REQUESTER_URL = '/process/help-desk/assigned-tickets';
const TECHNICIAN_SUBPROCESS_ID = 1;

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

function isHelpDeskProcess(processName) {
  const name = String(processName || '').toLowerCase();
  return (
    (name.includes('help') && name.includes('desk')) ||
    (name.includes('mesa') && name.includes('ayuda')) ||
    name.includes('mesa de ayuda') ||
    name.includes('help desk') ||
    (name.includes('soporte') && !name.includes('compra')) ||
    name === 'tickets' ||
    name === 'ticket'
  );
}

function isMyTicketsSubprocess(sub) {
  const url = (sub.subprocess_url ?? '').toLowerCase();
  const name = sub.subprocess.toLowerCase().trim();
  return (
    name === 'mis tickets' ||
    name === 'mis ticket' ||
    url.includes('assigned-ticket') ||
    url.includes('my-ticket') ||
    url.includes('/process/tickets/my-tickets')
  );
}

function isOperatorPanelSubprocess(sub) {
  if (isMyTicketsSubprocess(sub)) return false;
  if (sub.id_subprocess === TECHNICIAN_SUBPROCESS_ID) return true;
  const url = (sub.subprocess_url ?? '').toLowerCase();
  const name = sub.subprocess.toLowerCase().trim();
  return name === 'tickets' || name === 'ticket' || url.includes('create-ticket');
}

function expectedUrl(sub) {
  if (isMyTicketsSubprocess(sub)) return REQUESTER_URL;
  if (isOperatorPanelSubprocess(sub)) return OPERATOR_URL;
  return null;
}

loadEnv();

async function main() {
  const { PrismaClient } = require('../app/generated/prisma');
  const prisma = new PrismaClient();

  const subprocesses = await prisma.subprocess.findMany({
    include: { process: true },
    orderBy: { id_subprocess: 'asc' },
  });

  const helpDesk = subprocesses.filter((sub) => isHelpDeskProcess(sub.process.process));
  const updates = [];

  for (const sub of helpDesk) {
    const targetUrl = expectedUrl(sub);
    if (!targetUrl) continue;
    if (sub.subprocess_url === targetUrl) continue;
    updates.push({
      id: sub.id_subprocess,
      name: sub.subprocess,
      from: sub.subprocess_url,
      to: targetUrl,
    });
    await prisma.subprocess.update({
      where: { id_subprocess: sub.id_subprocess },
      data: { subprocess_url: targetUrl },
    });
  }

  if (updates.length === 0) {
    console.log('Sin cambios: las URLs de mesa de ayuda ya coinciden con la aplicación.');
  } else {
    console.log('URLs actualizadas:');
    console.log(JSON.stringify(updates, null, 2));
  }

  console.log('\nEstado actual (mesa de ayuda):');
  const current = await prisma.subprocess.findMany({
    where: { id_subprocess: { in: helpDesk.map((s) => s.id_subprocess) } },
    select: { id_subprocess: true, subprocess: true, subprocess_url: true },
    orderBy: { id_subprocess: 'asc' },
  });
  console.log(JSON.stringify(current, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
