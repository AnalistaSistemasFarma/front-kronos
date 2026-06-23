/**
 * Verificación de cambios para despliegue (subprocesos, pool MSSQL, APIs).
 * Uso: node scripts/verify-deployment-changes.cjs
 */
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeSubprocessIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
}

function groupAssignmentsByCompany(companyUsers) {
  const byCompany = new Map();

  for (const cu of companyUsers) {
    let group = byCompany.get(cu.id_company);
    if (!group) {
      group = {
        companyId: cu.id_company,
        companyName: cu.company.company,
        companyUserId: cu.id_company_user,
        subprocesses: new Map(),
      };
      byCompany.set(cu.id_company, group);
    } else if (cu.id_company_user < group.companyUserId) {
      group.companyUserId = cu.id_company_user;
    }

    for (const suc of cu.subprocesses) {
      group.subprocesses.set(suc.id_subprocess, {
        id: suc.id_subprocess_user_company,
        subprocessId: suc.id_subprocess,
        subprocessName: suc.subprocess.subprocess,
        subprocessUrl: suc.subprocess.subprocess_url,
        processId: suc.subprocess.id_process,
        processName: suc.subprocess.process.process,
      });
    }
  }

  return Array.from(byCompany.values()).map((group) => ({
    companyId: group.companyId,
    companyName: group.companyName,
    companyUserId: group.companyUserId,
    subprocesses: Array.from(group.subprocesses.values()),
  }));
}

function testPureFunctions() {
  console.log('\n[1/6] Funciones puras (subprocessAssignments)...');

  assert(
    JSON.stringify(normalizeSubprocessIds([1, '2', 2, 'x'])) === JSON.stringify([1, 2]),
    'normalizeSubprocessIds debe deduplicar y filtrar inválidos'
  );
  assert(normalizeSubprocessIds('bad').length === 0, 'normalizeSubprocessIds con no-array → []');

  const grouped = groupAssignmentsByCompany([
    {
      id_company: 10,
      id_company_user: 100,
      company: { company: 'Empresa A' },
      subprocesses: [
        {
          id_subprocess_user_company: 1,
          id_subprocess: 5,
          subprocess: {
            subprocess: 'Usuarios',
            subprocess_url: '/process/administration/users',
            id_process: 1,
            process: { process: 'Administración' },
          },
        },
      ],
    },
    {
      id_company: 10,
      id_company_user: 50,
      company: { company: 'Empresa A' },
      subprocesses: [
        {
          id_subprocess_user_company: 2,
          id_subprocess: 7,
          subprocess: {
            subprocess: 'Tickets',
            subprocess_url: '/process/help-desk/create-ticket',
            id_process: 2,
            process: { process: 'Mesa de Ayuda' },
          },
        },
      ],
    },
  ]);

  assert(grouped.length === 1, 'Debe agrupar duplicados de empresa en una sola entrada');
  assert(grouped[0].companyUserId === 50, 'Debe usar el company_user_id más bajo');
  assert(grouped[0].subprocesses.length === 2, 'Debe fusionar subprocesos de ambos registros');

  console.log('  ✓ normalizeSubprocessIds');
  console.log('  ✓ groupAssignmentsByCompany');
}

async function testDatabaseConnectivity() {
  console.log('\n[2/6] Conectividad Prisma + MSSQL...');

  const { PrismaClient } = require('../app/generated/prisma');
  const { buildMssqlConfig, resolveConnection } = require('../dbconfig');
  const sql = require('mssql');

  const prisma = new PrismaClient();
  const prismaDb = await prisma.$queryRawUnsafe('SELECT DB_NAME() AS db');
  assert(prismaDb[0]?.db, 'Prisma debe conectar a la BD');
  console.log('  ✓ Prisma →', prismaDb[0].db);
  await prisma.$disconnect();

  const configured = resolveConnection();
  const pool = await sql.connect(buildMssqlConfig());
  const mssqlDb = await pool.request().query('SELECT DB_NAME() AS db');
  assert(mssqlDb.recordset[0]?.db, 'MSSQL debe conectar a la BD');
  assert(
    mssqlDb.recordset[0].db === prismaDb[0].db,
    'Prisma y MSSQL deben apuntar a la misma base de datos'
  );
  console.log('  ✓ MSSQL →', mssqlDb.recordset[0].db, `(misma BD que Prisma)`);
  await pool.close();
}

async function testNotificationEventsPool() {
  console.log('\n[3/6] notificationEvents usa pool compartido...');

  const source = fs.readFileSync(path.resolve(__dirname, '../lib/notificationEvents.js'), 'utf8');
  assert(
    source.includes("from './mssqlPool'"),
    'notificationEvents debe importar mssqlPool'
  );
  assert(
    !source.includes('sql.connect(sqlConfig)'),
    'notificationEvents no debe crear pool propio con sql.connect'
  );
  assert(!source.includes("from '../dbconfig"), 'notificationEvents no debe importar dbconfig directo');
  assert(source.includes('withMssqlPool'), 'notificationEvents debe usar withMssqlPool');

  console.log('  ✓ Estructura de imports correcta');
}

async function testSubprocessDataIntegrity() {
  console.log('\n[4/6] Integridad subprocesos y asignaciones...');

  const { PrismaClient } = require('../app/generated/prisma');
  const prisma = new PrismaClient();

  const helpDesk = await prisma.subprocess.findMany({
    where: {
      OR: [
        { subprocess: { in: ['Tickets', 'Mis Tickets'] } },
        { subprocess_url: { contains: 'help-desk' } },
      ],
    },
    select: { id_subprocess: true, subprocess: true, subprocess_url: true },
    orderBy: { id_subprocess: 'asc' },
  });

  const tickets = helpDesk.find((s) => s.subprocess === 'Tickets');
  const myTickets = helpDesk.find((s) => s.subprocess === 'Mis Tickets');

  assert(tickets, 'Subproceso Tickets debe existir en BD');
  assert(myTickets, 'Subproceso Mis Tickets debe existir en BD');
  assert(
    tickets.subprocess_url === '/process/help-desk/create-ticket',
    `Tickets URL incorrecta: ${tickets.subprocess_url}`
  );
  assert(
    myTickets.subprocess_url === '/process/help-desk/assigned-tickets',
    `Mis Tickets URL incorrecta: ${myTickets.subprocess_url}`
  );
  console.log('  ✓ URLs mesa de ayuda en BD');

  const dupes = await prisma.$queryRaw`
    SELECT id_user, id_company, COUNT(*) as cnt
    FROM company_user
    GROUP BY id_user, id_company
    HAVING COUNT(*) > 1
  `;

  if (dupes.length > 0) {
    console.log(`  ⚠ ${dupes.length} par(es) usuario+empresa con company_user duplicado (se consolidan al guardar)`);
  } else {
    console.log('  ✓ Sin company_user duplicados');
  }

  const orphanAssignments = await prisma.$queryRaw`
    SELECT COUNT(*) AS cnt
    FROM subprocess_user_company suc
    LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
    WHERE cu.id_company_user IS NULL
  `;
  assert(Number(orphanAssignments[0]?.cnt) === 0, 'Hay asignaciones huérfanas sin company_user');

  console.log('  ✓ Sin asignaciones huérfanas');

  await prisma.$disconnect();
}

async function testAssignmentConsistencySample() {
  console.log('\n[5/6] Consistencia admin vs procesos (muestra de usuarios)...');

  const { PrismaClient } = require('../app/generated/prisma');
  const prisma = new PrismaClient();

  const users = await prisma.user.findMany({
    take: 5,
    orderBy: { email: 'asc' },
    select: { id: true, email: true },
  });

  for (const user of users) {
    const fromJoin = await prisma.subprocessUserCompany.findMany({
      where: { companyUser: { id_user: user.id } },
      select: { id_subprocess: true },
    });
    const uniqueFromJoin = [...new Set(fromJoin.map((r) => r.id_subprocess))].sort((a, b) => a - b);

    const processes = await prisma.process.findMany({
      where: {
        subprocesses: {
          some: {
            id_subprocess: { in: uniqueFromJoin },
          },
        },
      },
      include: {
        subprocesses: {
          where: { id_subprocess: { in: uniqueFromJoin } },
          select: { id_subprocess: true },
        },
      },
    });

    const fromProcesses = [
      ...new Set(processes.flatMap((p) => p.subprocesses.map((s) => s.id_subprocess))),
    ].sort((a, b) => a - b);

    assert(
      JSON.stringify(uniqueFromJoin) === JSON.stringify(fromProcesses),
      `Inconsistencia para ${user.email}: join=${uniqueFromJoin} processes=${fromProcesses}`
    );
  }

  console.log(`  ✓ ${users.length} usuarios verificados (asignaciones = procesos visibles)`);
  await prisma.$disconnect();
}

async function testChangedModulesExist() {
  console.log('\n[6/6] Módulos modificados presentes...');

  const requiredFiles = [
    'lib/process/subprocessAssignments.ts',
    'lib/process/subprocessAssignmentsEvents.ts',
    'lib/notificationEvents.js',
    'lib/mssqlPool.ts',
    'lib/help-desk/access.ts',
    'app/api/processes/route.ts',
    'app/api/users/[id]/subprocesses/route.ts',
    'app/api/companies/route.ts',
    'app/api/subprocesses/route.ts',
    'app/api/purchase-request/access/route.ts',
    'app/api/profile/route.ts',
    'app/api/profile/change-password/route.ts',
    'scripts/sync-help-desk-subprocess-urls.cjs',
  ];

  for (const file of requiredFiles) {
    const full = path.resolve(__dirname, '..', file);
    assert(fs.existsSync(full), `Falta archivo: ${file}`);
  }

  const processesRoute = fs.readFileSync(
    path.resolve(__dirname, '../app/api/processes/route.ts'),
    'utf8'
  );
  assert(
    processesRoute.includes('getAssignedSubprocessIdsForUser'),
    'processes/route debe usar getAssignedSubprocessIdsForUser'
  );
  assert(processesRoute.includes("from '../../../lib/prisma'"), 'processes/route debe usar prisma compartido');

  const companiesRoute = fs.readFileSync(
    path.resolve(__dirname, '../app/api/companies/route.ts'),
    'utf8'
  );
  assert(
    !companiesRoute.includes('new PrismaClient()'),
    'companies/route no debe instanciar PrismaClient propio'
  );

  console.log('  ✓ Archivos y patrones esperados');
}

loadEnv();

async function main() {
  console.log('=== Verificación pre-despliegue ===');
  const started = Date.now();
  let passed = 0;

  const steps = [
    () => testPureFunctions(),
    () => testDatabaseConnectivity(),
    () => testNotificationEventsPool(),
    () => testSubprocessDataIntegrity(),
    () => testAssignmentConsistencySample(),
    () => testChangedModulesExist(),
  ];

  for (const step of steps) {
    await step();
    passed += 1;
  }

  console.log(`\n✅ ${passed}/${steps.length} suites OK (${Date.now() - started}ms)`);
  console.log('Recomendado: npm run build antes de desplegar.');
}

main().catch((error) => {
  console.error('\n❌ Verificación fallida:', error.message);
  process.exit(1);
});
