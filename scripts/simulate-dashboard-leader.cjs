/**
 * Simula enrichTasks + agrupación como EncargadoActivitiesChart
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

loadEnv();

function resolveSolicitudId(row) {
  const raw = row.id_solicitud ?? row.ID_Solicitud ?? row.id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function enrichTasks(tasks, requests) {
  const leaderBy = new Map();
  for (const r of requests) {
    const leader = r.encargado_proceso?.trim();
    if (r.id_solicitud != null && leader) leaderBy.set(r.id_solicitud, leader);
  }
  return tasks.map((t) => {
    const id = resolveSolicitudId(t);
    return {
      ...t,
      id_solicitud: id,
      encargado_proceso: t.encargado_proceso?.trim() || (id != null ? leaderBy.get(id) : null) || null,
    };
  });
}

async function main() {
  const sql = require('mssql');
  const { buildMssqlConfig } = require('../dbconfig');
  const pool = await sql.connect(buildMssqlConfig());

  const dateFrom = '2026-06-01';
  const dateTo = '2026-06-05';

  const tasksRes = await pool.request().query(`
    SELECT * FROM vw_tareas_solicitudes
    WHERE CAST(fecha_creacion_solicitud AS DATE) >= '${dateFrom}'
      AND CAST(fecha_creacion_solicitud AS DATE) <= '${dateTo}'
  `);
  const reqsRes = await pool.request().query(`
    SELECT NumeroSolicitud, UsuarioAsignado FROM vw_requests_general
    WHERE CAST(FechaCreación AS DATE) >= '${dateFrom}'
      AND CAST(FechaCreación AS DATE) <= '${dateTo}'
  `);

  const requests = reqsRes.recordset.map((r) => ({
    id_solicitud: r.NumeroSolicitud,
    encargado_proceso: (r.UsuarioAsignado || '').trim() || null,
  }));

  const tasks = enrichTasks(tasksRes.recordset, requests);
  const leader = 'Nicolás Rivera';
  const filtered = tasks.filter((t) => (t.encargado_proceso || '') === leader);

  const byAssignee = {};
  for (const t of filtered) {
    const name = (t.asignado_tarea || '').trim() || 'Sin asignar';
    byAssignee[name] = (byAssignee[name] || 0) + 1;
  }

  console.log('Periodo:', dateFrom, dateTo);
  console.log('Tareas totales API:', tasksRes.recordset.length);
  console.log('Tareas líder', leader + ':', filtered.length);
  console.log('Colaboradores (asignado_tarea):', byAssignee);

  // YTD
  const tasksYtd = await pool.request().query(`
    SELECT * FROM vw_tareas_solicitudes
    WHERE CAST(fecha_creacion_solicitud AS DATE) >= '2026-01-01'
      AND CAST(fecha_creacion_solicitud AS DATE) <= '2026-06-05'
  `);
  const reqsYtd = await pool.request().query(`
    SELECT NumeroSolicitud, UsuarioAsignado FROM vw_requests_general
    WHERE CAST(FechaCreación AS DATE) >= '2026-01-01'
      AND CAST(FechaCreación AS DATE) <= '2026-06-05'
  `);
  const requestsYtd = reqsYtd.recordset.map((r) => ({
    id_solicitud: r.NumeroSolicitud,
    encargado_proceso: (r.UsuarioAsignado || '').trim() || null,
  }));
  const tasksY = enrichTasks(tasksYtd.recordset, requestsYtd);
  const filteredY = tasksY.filter((t) => (t.encargado_proceso || '') === leader);
  const byY = {};
  for (const t of filteredY) {
    const name = (t.asignado_tarea || '').trim() || 'Sin asignar';
    byY[name] = (byY[name] || 0) + 1;
  }
  console.log('\nYTD ene-jun 2026 - colaboradores:', byY);

  await pool.close();
}

main().catch(console.error);
