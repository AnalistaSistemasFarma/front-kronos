import os from 'node:os';
import { sql, withMssqlPool } from '../mssqlPool';
import { buildSapsendLiveSnapshot } from './live.js';

/**
 * Persiste una foto del monitor en la caja negra (si las tablas existen).
 * Pensado para correrse cada ~15 s desde un job / tick del proceso.
 * Nunca lanza: si faltan tablas o falla el INSERT, devuelve { ok:false }.
 */

function instanceId() {
  return String(process.env.NODE_APP_INSTANCE ?? process.env.pm_id ?? '0').slice(0, 16);
}

export async function blackboxTablesExist() {
  try {
    return await withMssqlPool(async (pool) => {
      const r = await pool.request().query(`
        SELECT
          OBJECT_ID(N'dbo.sapsend_monitor_sample', N'U') AS sample_id,
          OBJECT_ID(N'dbo.sapsend_monitor_block', N'U') AS block_id,
          OBJECT_ID(N'dbo.sapsend_monitor_heavy', N'U') AS heavy_id
      `);
      const row = r.recordset[0] || {};
      return Boolean(row.sample_id && row.block_id && row.heavy_id);
    });
  } catch {
    return false;
  }
}

export async function persistBlackboxSnapshot(snapshot) {
  const snap = snapshot ?? (await buildSapsendLiveSnapshot());
  const host = os.hostname().slice(0, 128);
  const instance = instanceId();
  const sampledAt = new Date(snap.sampledAt);

  try {
    await withMssqlPool(async (pool) => {
      const exists = await pool.request().query(`
        SELECT OBJECT_ID(N'dbo.sapsend_monitor_sample', N'U') AS id
      `);
      if (!exists.recordset[0]?.id) {
        throw new Error('Faltan tablas de caja negra (prisma/manual/2026-11-18-sapsend-monitor-blackbox.sql)');
      }

      for (const c of snap.companies || []) {
        await pool
          .request()
          .input('sampled_at', sql.DateTime2(0), sampledAt)
          .input('host', sql.NVarChar(128), host)
          .input('instance', sql.NVarChar(16), instance)
          .input('id_company', sql.Int, c.idCompany)
          .input('company_name', sql.NVarChar(200), c.company)
          .input('sapsend_db', sql.NVarChar(128), c.sapsendDb)
          .input('sap_db', sql.NVarChar(128), c.sap?.database ?? null)
          .input('ss_sessions', sql.Int, c.sapsend?.sessions)
          .input('ss_running', sql.Int, c.sapsend?.running)
          .input('ss_blocked', sql.Int, c.sapsend?.blocked)
          .input('sap_sessions', sql.Int, c.sap?.sessions)
          .input('sap_running', sql.Int, c.sap?.running)
          .input('sap_blocked', sql.Int, c.sap?.blocked)
          .input('sap_sl_sessions', sql.Int, c.sap?.serviceLayer)
          .input('sap_sapsend_sessions', sql.Int, c.sap?.sapsend)
          .input('sap_client_sessions', sql.Int, c.sap?.sapClient)
          .input('sl_pulse_ms', sql.Int, null)
          .input('sl_pulse_ok', sql.Bit, null)
          .input('syn_inflight', sql.Int, snap.totals?.inflight ?? 0)
          .input('syn_open_sessions', sql.Int, 0)
          .input('syn_errors_5m', sql.Int, snap.totals?.errors5m ?? 0)
          .input('status', sql.NVarChar(16), c.status)
          .input('note', sql.NVarChar(400), c.sap?.note ?? null)
          .query(`
            INSERT INTO dbo.sapsend_monitor_sample (
              sampled_at, host, instance, id_company, company_name, sapsend_db, sap_db,
              ss_sessions, ss_running, ss_blocked,
              sap_sessions, sap_running, sap_blocked,
              sap_sl_sessions, sap_sapsend_sessions, sap_client_sessions,
              sl_pulse_ms, sl_pulse_ok,
              syn_inflight, syn_open_sessions, syn_errors_5m,
              status, note
            ) VALUES (
              @sampled_at, @host, @instance, @id_company, @company_name, @sapsend_db, @sap_db,
              @ss_sessions, @ss_running, @ss_blocked,
              @sap_sessions, @sap_running, @sap_blocked,
              @sap_sl_sessions, @sap_sapsend_sessions, @sap_client_sessions,
              @sl_pulse_ms, @sl_pulse_ok,
              @syn_inflight, @syn_open_sessions, @syn_errors_5m,
              @status, @note
            )
          `);
      }

      for (const b of snap.blocks || []) {
        await pool
          .request()
          .input('sampled_at', sql.DateTime2(0), sampledAt)
          .input('host', sql.NVarChar(128), host)
          .input('instance', sql.NVarChar(16), instance)
          .input('database_name', sql.NVarChar(128), b.database)
          .input('blocked_session_id', sql.Int, b.blockedSessionId)
          .input('blocking_session_id', sql.Int, b.blockingSessionId)
          .input('wait_type', sql.NVarChar(120), b.waitType)
          .input('wait_ms', sql.Int, b.waitMs)
          .input('blocked_program', sql.NVarChar(256), b.blockedProgram)
          .input('blocking_program', sql.NVarChar(256), b.blockingProgram)
          .input('blocked_login', sql.NVarChar(128), b.blockedLogin)
          .input('blocking_login', sql.NVarChar(128), b.blockingLogin)
          .input('blocked_sql', sql.NVarChar(sql.MAX), b.blockedSql)
          .input('blocking_sql', sql.NVarChar(sql.MAX), b.blockingSql)
          .query(`
            INSERT INTO dbo.sapsend_monitor_block (
              sampled_at, host, instance, database_name,
              blocked_session_id, blocking_session_id, wait_type, wait_ms,
              blocked_program, blocking_program, blocked_login, blocking_login,
              blocked_sql, blocking_sql
            ) VALUES (
              @sampled_at, @host, @instance, @database_name,
              @blocked_session_id, @blocking_session_id, @wait_type, @wait_ms,
              @blocked_program, @blocking_program, @blocked_login, @blocking_login,
              @blocked_sql, @blocking_sql
            )
          `);
      }

      for (const h of snap.heavy || []) {
        await pool
          .request()
          .input('sampled_at', sql.DateTime2(0), sampledAt)
          .input('host', sql.NVarChar(128), host)
          .input('instance', sql.NVarChar(16), instance)
          .input('database_name', sql.NVarChar(128), h.database)
          .input('session_id', sql.Int, h.sessionId)
          .input('program_name', sql.NVarChar(256), h.programName)
          .input('login_name', sql.NVarChar(128), h.loginName)
          .input('status', sql.NVarChar(60), h.status)
          .input('wait_type', sql.NVarChar(120), h.waitType)
          .input('elapsed_ms', sql.Int, h.elapsedMs)
          .input('cpu_ms', sql.Int, h.cpuMs)
          .input('sql_text', sql.NVarChar(sql.MAX), h.sqlText)
          .query(`
            INSERT INTO dbo.sapsend_monitor_heavy (
              sampled_at, host, instance, database_name, session_id,
              program_name, login_name, status, wait_type, elapsed_ms, cpu_ms, sql_text
            ) VALUES (
              @sampled_at, @host, @instance, @database_name, @session_id,
              @program_name, @login_name, @status, @wait_type, @elapsed_ms, @cpu_ms, @sql_text
            )
          `);
      }
    });
    return { ok: true };
  } catch (err) {
    console.warn('[sapsend/blackbox]', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}
