import 'server-only';
import os from 'node:os';
import {
  buildBlockingChains,
  evaluateSqlAlerts,
  observeIncidents,
  viewCostDeltas,
  waitDeltas,
  type ViewCost,
  type WaitStatRow,
} from './analysis';
import { isSapSqlMonitorEnabled, sapRetentionDays, sapSqlConfig } from './config';

/**
 * Background job of the SAP monitor. Runs only in the primary process (NODE_APP_INSTANCE 0 or
 * unset) and only when SAP_SQL_MONITOR_URL is set. Cadence:
 *   - every 60 s: DMV probe (blocking, long requests, open transactions, wait deltas);
 *   - every 15 min: cost of the *B1SLQuery views from the plan cache;
 *   - every 6 h: inventory of *B1SLQuery views;   - every 24 h: retention cleanup.
 * A cycle is skipped while the previous one is still running; after 3 failures in a row it backs
 * off 5 minutes. It never retries a query inside the same cycle.
 */

const TICK_MS = 60_000;
const VIEWS_EVERY_MS = 15 * 60_000;
const INVENTORY_EVERY_MS = 6 * 60 * 60_000;
const CLEANUP_EVERY_MS = 24 * 60 * 60_000;
const PAUSE_MISSING_TABLES_MS = 10 * 60_000;
const BACKOFF_MS = 5 * 60_000;

export type SapMonitorStatus = {
  enabled: boolean;
  startedAt: string | null;
  lastRunAt: string | null;
  lastProbeMs: number | null;
  lastError: string | null;
  skipped: number;
  pausedReason: string | null;
};

declare global {
  var __sapMonitorJob: { status: SapMonitorStatus; timer?: ReturnType<typeof setInterval> } | undefined;
}

function isPrimaryInstance(): boolean {
  const instance = process.env.NODE_APP_INSTANCE;
  return instance === undefined || instance === '0';
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const isMissingTable = (e: unknown) => typeof e === 'object' && e !== null && (e as { number?: number }).number === 208;

export function getSapMonitorStatus(): SapMonitorStatus {
  return (
    globalThis.__sapMonitorJob?.status ?? {
      enabled: isSapSqlMonitorEnabled(),
      startedAt: null,
      lastRunAt: null,
      lastProbeMs: null,
      lastError: null,
      skipped: 0,
      pausedReason: null,
    }
  );
}

export function startSapMonitor(): void {
  if (globalThis.__sapMonitorJob || !isPrimaryInstance() || !isSapSqlMonitorEnabled()) return;
  const status: SapMonitorStatus = {
    enabled: true,
    startedAt: new Date().toISOString(),
    lastRunAt: null,
    lastProbeMs: null,
    lastError: null,
    skipped: 0,
    pausedReason: null,
  };
  const state: { status: SapMonitorStatus; timer?: ReturnType<typeof setInterval> } = { status };
  globalThis.__sapMonitorJob = state;

  let running = false;
  let failures = 0;
  let pausedUntil = 0;
  let prevWaits: WaitStatRow[] | null = null;
  let prevViews: ViewCost[] | null = null;
  let lastViewsAt = 0;
  let lastInventoryAt = 0;
  let lastCleanupAt = Date.now() - CLEANUP_EVERY_MS + 10 * 60_000;
  const host = os.hostname();

  const tick = async () => {
    if (running) {
      status.skipped += 1;
      return;
    }
    if (Date.now() < pausedUntil) return;
    running = true;
    const at = new Date();
    at.setSeconds(0, 0);
    const [{ getPool }, probe, store] = await Promise.all([import('../mssqlPool'), import('./sqlProbe'), import('./store')]);
    let kronos: Awaited<ReturnType<typeof getPool>> | null = null;
    try {
      kronos = await getPool();
      const config = sapSqlConfig();
      if (!config) throw new Error('SAP_SQL_MONITOR_URL no es válido');
      const sap = await probe.getSapPool(config);
      const snap = await probe.probeSapSql(sap);
      const chains = buildBlockingChains(snap.requests, snap.blockers);
      const observations = observeIncidents({ chains, requests: snap.requests, openTx: snap.openTx });

      // Lock counts only when there is something to explain.
      const interesting = [...chains.map((c) => c.head.sessionId), ...snap.openTx.map((t) => t.sessionId)];
      if (interesting.length) {
        const locks = await probe.probeLockCounts(sap, interesting).catch(() => new Map<number, number>());
        for (const t of snap.openTx) t.locks = locks.get(t.sessionId) ?? null;
        for (const c of chains) (c.head as typeof c.head & { locks?: number | null }).locks = locks.get(c.head.sessionId) ?? null;
      }

      const waits = waitDeltas(prevWaits, snap.waits);
      prevWaits = snap.waits;
      const longRequests = snap.requests.filter((r) => r.runningSec >= 120);
      const hasDetail = chains.length > 0 || longRequests.length > 0 || snap.openTx.length > 0;

      await store.insertSapSample(kronos, at, {
        probeMs: snap.probeMs,
        userSessions: snap.userSessions,
        activeRequests: snap.activeRequests,
        blocked: chains.reduce((sum, c) => sum + c.blockedCount, 0),
        maxBlockSec: chains.reduce((m, c) => Math.max(m, c.maxWaitSec), 0),
        longRequests: longRequests.length,
        maxRequestSec: longRequests.reduce((m, r) => Math.max(m, r.runningSec), 0),
        openTx: snap.openTx.length,
        maxTxSec: snap.openTx.reduce((m, t) => Math.max(m, t.openSec), 0),
        waits,
        detail: hasDetail
          ? { chains: chains.slice(0, 10), longRequests: longRequests.slice(0, 15), openTx: snap.openTx.slice(0, 15), hasServerState: snap.hasServerState }
          : snap.hasServerState
            ? null
            : { hasServerState: false },
        error: null,
      });
      if (observations.length) await store.upsertIncidents(kronos, at, observations);

      const { raiseSapAlerts } = await import('./alerts');
      const sent = await raiseSapAlerts(kronos, host, evaluateSqlAlerts(observations), at).catch((e) => {
        console.warn('[sap-monitor] Alertas:', errorText(e));
        return [];
      });
      if (sent.length) console.warn(`[sap-monitor] Alertas enviadas: ${sent.map((w) => w.key).join(', ')}`);

      if (Date.now() - lastViewsAt >= VIEWS_EVERY_MS) {
        lastViewsAt = Date.now();
        const { views } = await probe.probeViewCosts(sap);
        const deltas = viewCostDeltas(prevViews, views);
        prevViews = views;
        await store.insertViewStats(kronos, at, deltas);
      }
      if (Date.now() - lastInventoryAt >= INVENTORY_EVERY_MS) {
        lastInventoryAt = Date.now();
        const inventory = await probe.probeViewInventory(sap).catch((e) => {
          console.warn('[sap-monitor] Inventario de vistas:', errorText(e));
          return [];
        });
        if (inventory.length) await store.upsertViewInventory(kronos, at, inventory);
      }
      if (Date.now() - lastCleanupAt >= CLEANUP_EVERY_MS) {
        lastCleanupAt = Date.now();
        const deleted = await store.deleteOldSapMetrics(kronos, sapRetentionDays());
        if (deleted) console.log(`[sap-monitor] Limpieza: ${deleted} filas de más de ${sapRetentionDays()} días`);
      }

      failures = 0;
      status.lastRunAt = new Date().toISOString();
      status.lastProbeMs = snap.probeMs;
      status.lastError = null;
      status.pausedReason = null;
    } catch (error) {
      if (isMissingTable(error)) {
        pausedUntil = Date.now() + PAUSE_MISSING_TABLES_MS;
        status.pausedReason = 'Faltan las tablas sap_monitor_* (prisma/manual/2026-11-20-monitor-sap-*.sql)';
      } else {
        failures += 1;
        status.lastError = errorText(error);
        console.warn('[sap-monitor] Ciclo fallido:', status.lastError);
        // Record the failure so the screen shows a gap with a reason (best effort).
        if (kronos) {
          await store
            .insertSapSample(kronos, at, {
              probeMs: null, userSessions: null, activeRequests: null, blocked: null, maxBlockSec: null,
              longRequests: null, maxRequestSec: null, openTx: null, maxTxSec: null, waits: [], detail: null,
              error: status.lastError,
            })
            .catch(() => undefined);
        }
        await probe.closeSapPool();
        if (failures >= 3) {
          pausedUntil = Date.now() + BACKOFF_MS;
          failures = 0;
        }
      }
    } finally {
      running = false;
    }
  };

  state.timer = setInterval(() => void tick(), TICK_MS);
  state.timer.unref?.();
  // First probe a little after start, so the app boot is not loaded.
  setTimeout(() => void tick(), 20_000).unref?.();
  console.log(`[sap-monitor] Iniciado (host ${host}, pid ${process.pid})`);
}
