const fs = require('fs');
const path = require('path');

function loadEnv() {
  for (const line of fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

loadEnv();

async function main() {
  const { getPool } = require('../lib/mssqlPool');
  const {
    queryDashboardTasks,
    queryTasksBySolicitudIds,
    queryCategoryMembersByNames,
    resolveSolicitudId,
  } = require('../lib/dashboard/viewTasksQuery.ts');
  const { enrichTasksWithEncargadoFromRequests } = require('../lib/dashboard/enrichTasksWithEncargado.ts');
  const { queryDashboardRequests } = require('../lib/dashboard/viewRequestsQuery.ts');

  const pool = await getPool();
  const filters = { date_from: '2026-06-01', date_to: '2026-06-05' };

  const [data, requests] = await Promise.all([
    queryDashboardTasks(pool, filters),
    queryDashboardRequests(pool, filters),
  ]);

  const solicitudIds = [...new Set(data.map((r) => resolveSolicitudId(r)).filter(Boolean))];
  const [teamRoster, categoryMembers] = await Promise.all([
    queryTasksBySolicitudIds(pool, solicitudIds),
    queryCategoryMembersByNames(pool, data.map((r) => r.categoria_solicitud)),
  ]);

  const enriched = enrichTasksWithEncargadoFromRequests(data, requests);
  const enrichedRoster = enrichTasksWithEncargadoFromRequests(teamRoster, requests);

  const leader = 'Nicolás Rivera';
  const period = enriched.filter((t) => (t.encargado_proceso || '') === leader);
  const roster = enrichedRoster.filter((t) => (t.encargado_proceso || '') === leader);

  const byAssignee = {};
  for (const t of roster) {
    const n = (t.asignado_tarea || '').trim();
    byAssignee[n] = (byAssignee[n] || 0) + 1;
  }

  console.log('=== Simulación API view-tasks (jun 2026) ===');
  console.log('Tareas periodo líder', leader + ':', period.length);
  console.log('Tareas roster solicitud:', roster.length);
  console.log('Colaboradores con tareas (asignado_tarea):', byAssignee);
  console.log('Miembros categoría Tecnologia:', categoryMembers.Tecnologia || categoryMembers['Tecnologia']);

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
