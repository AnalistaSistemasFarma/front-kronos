/**
 * Pure logic of the SAP monitor (SQL of SAP + Service Layer): blocking chains, incidents,
 * wait-stat deltas, view-cost aggregation and alert rules. No SQL, no fetch: everything here
 * is unit tested (lib/sap-monitor/__tests__/analysis.test.ts).
 *
 * Text shown to people is Spanish; identifiers are English.
 */

import type { EarlyWarning } from '../system-metrics/earlyWarnings';

export const SAP_THRESHOLDS = {
  /** A request counts as "long" from this many seconds (shown live). */
  longRequestSec: 120,
  /** A user transaction counts as "open" from this many seconds (shown live). */
  openTxSec: 60,
  alert: {
    blockingSec: 120,
    blockingCriticalSec: 600,
    queryWarningSec: 300,
    queryCriticalSec: 900,
    txWarningSec: 300,
    txCriticalSec: 900,
    viewTimeouts: 3,
    viewWindowMin: 15,
    slHandles: { warning: 5000, critical: 6000 },
  },
} as const;

/** One row of sys.dm_exec_requests joined with its session (only interesting ones). */
export type SapRequestRow = {
  sessionId: number;
  blockingSessionId: number;
  status: string | null;
  command: string | null;
  waitType: string | null;
  waitMs: number;
  waitResource: string | null;
  runningSec: number;
  databaseName: string | null;
  openTransactions: number;
  hostName: string | null;
  loginName: string | null;
  programName: string | null;
  statement: string | null;
  /** Stable id of the session's login_time (seconds since 2020 in server time): unique across session-id reuse. */
  sessionStart: string | null;
  /** Stable id of the request's start_time (same unit). */
  requestStart: string | null;
};

/** A session that blocks others (may be idle, "sleeping" with an open transaction). */
export type SapBlockerSession = {
  sessionId: number;
  status: string | null;
  hostName: string | null;
  loginName: string | null;
  programName: string | null;
  databaseName: string | null;
  openTransactions: number;
  idleSec: number | null;
  lastStatement: string | null;
  sessionStart: string | null;
};

export type SapOpenTx = {
  sessionId: number;
  openSec: number;
  name: string | null;
  hostName: string | null;
  loginName: string | null;
  programName: string | null;
  databaseName: string | null;
  sessionStatus: string | null;
  lastStatement: string | null;
  sessionStart: string | null;
  locks: number | null;
};

export type BlockingChain = {
  /** Head of the chain: blocks others and is not blocked itself. */
  head: SapBlockerSession;
  /** How long the oldest victim has been waiting, seconds. */
  maxWaitSec: number;
  blockedCount: number;
  victims: Array<Pick<SapRequestRow, 'sessionId' | 'blockingSessionId' | 'waitType' | 'waitMs' | 'waitResource' | 'hostName' | 'programName' | 'databaseName' | 'statement'>>;
};

export type WaitStatRow = { waitType: string; tasks: number; waitMs: number };
export type WaitDelta = { waitType: string; tasks: number; waitMs: number };

/**
 * Builds blocking chains: every blocked request walks up `blocking_session_id` until a session
 * that is not blocked (the head). Cycles (deadlocks in progress) stop at the first repeat.
 */
export function buildBlockingChains(requests: SapRequestRow[], blockers: SapBlockerSession[]): BlockingChain[] {
  const blockedBy = new Map<number, number>();
  for (const r of requests) if (r.blockingSessionId > 0 && r.blockingSessionId !== r.sessionId) blockedBy.set(r.sessionId, r.blockingSessionId);
  const sessionInfo = new Map<number, SapBlockerSession>();
  for (const b of blockers) sessionInfo.set(b.sessionId, b);
  for (const r of requests) {
    if (!sessionInfo.has(r.sessionId)) {
      sessionInfo.set(r.sessionId, {
        sessionId: r.sessionId,
        status: r.status,
        hostName: r.hostName,
        loginName: r.loginName,
        programName: r.programName,
        databaseName: r.databaseName,
        openTransactions: r.openTransactions,
        idleSec: null,
        lastStatement: r.statement,
        sessionStart: r.sessionStart,
      });
    }
  }

  const headOf = (sessionId: number): number => {
    const seen = new Set<number>([sessionId]);
    let current = sessionId;
    while (blockedBy.has(current)) {
      const next = blockedBy.get(current)!;
      if (seen.has(next)) return next;
      seen.add(next);
      current = next;
    }
    return current;
  };

  const chains = new Map<number, BlockingChain>();
  for (const r of requests) {
    if (!blockedBy.has(r.sessionId)) continue;
    const headId = headOf(r.sessionId);
    let chain = chains.get(headId);
    if (!chain) {
      const head = sessionInfo.get(headId) ?? {
        sessionId: headId,
        status: null,
        hostName: null,
        loginName: null,
        programName: null,
        databaseName: null,
        openTransactions: 0,
        idleSec: null,
        lastStatement: null,
        sessionStart: null,
      };
      chain = { head, maxWaitSec: 0, blockedCount: 0, victims: [] };
      chains.set(headId, chain);
    }
    chain.blockedCount += 1;
    chain.maxWaitSec = Math.max(chain.maxWaitSec, Math.floor(r.waitMs / 1000));
    if (chain.victims.length < 10) {
      chain.victims.push({
        sessionId: r.sessionId,
        blockingSessionId: r.blockingSessionId,
        waitType: r.waitType,
        waitMs: r.waitMs,
        waitResource: r.waitResource,
        hostName: r.hostName,
        programName: r.programName,
        databaseName: r.databaseName,
        statement: r.statement,
      });
    }
  }
  return [...chains.values()].sort((a, b) => b.maxWaitSec - a.maxWaitSec);
}

/** Waits that say nothing about user pain (idle/background). */
const BENIGN_WAIT = /^(SLEEP_|BROKER_|XE_|SQLTRACE_|LAZYWRITER_SLEEP|CHECKPOINT_QUEUE|REQUEST_FOR_DEADLOCK_SEARCH|LOGMGR_QUEUE|DIRTY_PAGE_POLL|HADR_|SP_SERVER_DIAGNOSTICS_SLEEP|FT_IFTS|ONDEMAND_TASK_QUEUE|WAITFOR|CLR_|DISPATCHER_QUEUE_SEMAPHORE|SOS_WORK_DISPATCHER|QDS_|PWAIT_|PREEMPTIVE_XE|KSOURCE_WAKEUP|MEMORY_ALLOCATION_EXT|RESOURCE_QUEUE|SERVER_IDLE_CHECK|SNI_HTTP_ACCEPT|WAIT_XTP|XTP_|PARALLEL_REDO|SOS_SCHEDULER_YIELD_IDLE|WAIT_FOR_RESULTS|CXCONSUMER)/;

export function isBenignWait(waitType: string): boolean {
  return BENIGN_WAIT.test(waitType);
}

/** Per-minute deltas of sys.dm_os_wait_stats (cumulative since restart); top N by wait time. */
export function waitDeltas(previous: WaitStatRow[] | null, current: WaitStatRow[], top = 8): WaitDelta[] {
  if (!previous) return [];
  const prev = new Map(previous.map((w) => [w.waitType, w]));
  const out: WaitDelta[] = [];
  for (const w of current) {
    if (isBenignWait(w.waitType)) continue;
    const p = prev.get(w.waitType);
    // A counter that went down means the stats were cleared or SQL restarted: no delta.
    if (!p || w.waitMs < p.waitMs) continue;
    const waitMs = w.waitMs - p.waitMs;
    if (waitMs <= 0) continue;
    out.push({ waitType: w.waitType, tasks: Math.max(0, w.tasks - p.tasks), waitMs });
  }
  return out.sort((a, b) => b.waitMs - a.waitMs).slice(0, top);
}

// ---------------------------------------------------------------------------
// Incidents (one row per blocking chain / long query / open transaction)
// ---------------------------------------------------------------------------

export type IncidentKind = 'bloqueo' | 'consulta' | 'transaccion';

export type IncidentObservation = {
  key: string;
  kind: IncidentKind;
  seconds: number;
  blocked: number | null;
  sessionId: number;
  databaseName: string | null;
  hostName: string | null;
  loginName: string | null;
  programName: string | null;
  waitResource: string | null;
  statement: string | null;
};

const stamp = (id: string | null) => id ?? 'na';

export function incidentKey(kind: IncidentKind, sessionId: number, sessionStart: string | null, extra = ''): string {
  return `sap-${kind}:${sessionId}:${stamp(sessionStart)}${extra ? `:${extra}` : ''}`.slice(0, 120);
}

export function observeIncidents(input: {
  chains: BlockingChain[];
  requests: SapRequestRow[];
  openTx: SapOpenTx[];
}): IncidentObservation[] {
  const out: IncidentObservation[] = [];
  for (const c of input.chains) {
    if (c.maxWaitSec < 30) continue;
    out.push({
      key: incidentKey('bloqueo', c.head.sessionId, c.head.sessionStart),
      kind: 'bloqueo',
      seconds: c.maxWaitSec,
      blocked: c.blockedCount,
      sessionId: c.head.sessionId,
      databaseName: c.head.databaseName,
      hostName: c.head.hostName,
      loginName: c.head.loginName,
      programName: c.head.programName,
      waitResource: c.victims[0]?.waitResource ?? null,
      statement: c.head.lastStatement,
    });
  }
  for (const r of input.requests) {
    if (r.runningSec < SAP_THRESHOLDS.longRequestSec) continue;
    out.push({
      // The same session can run several long queries: the request start makes it unique.
      key: incidentKey('consulta', r.sessionId, r.sessionStart, r.requestStart ?? ''),
      kind: 'consulta',
      seconds: r.runningSec,
      blocked: null,
      sessionId: r.sessionId,
      databaseName: r.databaseName,
      hostName: r.hostName,
      loginName: r.loginName,
      programName: r.programName,
      waitResource: r.waitResource,
      statement: r.statement,
    });
  }
  for (const t of input.openTx) {
    out.push({
      key: incidentKey('transaccion', t.sessionId, t.sessionStart),
      kind: 'transaccion',
      seconds: t.openSec,
      blocked: null,
      sessionId: t.sessionId,
      databaseName: t.databaseName,
      hostName: t.hostName,
      loginName: t.loginName,
      programName: t.programName,
      waitResource: null,
      statement: t.lastStatement,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Views (*B1SLQuery) cost from the plan cache
// ---------------------------------------------------------------------------

export type QueryStatRow = {
  databaseName: string | null;
  text: string;
  executions: number;
  totalElapsedMs: number;
  totalCpuMs: number;
  totalReads: number;
  maxElapsedMs: number;
  lastExecutionAt: string | null;
};

export type ViewCost = {
  databaseName: string;
  viewName: string;
  plans: number;
  executions: number;
  totalElapsedMs: number;
  totalCpuMs: number;
  totalReads: number;
  maxElapsedMs: number;
  lastExecutionAt: string | null;
};

const VIEW_NAME = /\b([A-Za-z0-9_]{1,120}B1SLQuery)\b/gi;

/** View names referenced by a statement (Service Layer quotes them: "OLP_IND_VentasB1SLQuery"). */
export function viewNamesIn(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(VIEW_NAME)) names.add(m[1]);
  return [...names];
}

/** Groups plan-cache rows by (database, view). A statement that touches 2 views counts for both. */
export function aggregateViewCosts(rows: QueryStatRow[]): ViewCost[] {
  const map = new Map<string, ViewCost>();
  for (const r of rows) {
    for (const viewName of viewNamesIn(r.text)) {
      const databaseName = r.databaseName ?? '(desconocida)';
      const key = `${databaseName}\u0000${viewName.toLowerCase()}`;
      const v = map.get(key) ?? {
        databaseName,
        viewName,
        plans: 0,
        executions: 0,
        totalElapsedMs: 0,
        totalCpuMs: 0,
        totalReads: 0,
        maxElapsedMs: 0,
        lastExecutionAt: null,
      };
      v.plans += 1;
      v.executions += r.executions;
      v.totalElapsedMs += r.totalElapsedMs;
      v.totalCpuMs += r.totalCpuMs;
      v.totalReads += r.totalReads;
      v.maxElapsedMs = Math.max(v.maxElapsedMs, r.maxElapsedMs);
      if (r.lastExecutionAt && (!v.lastExecutionAt || r.lastExecutionAt > v.lastExecutionAt)) v.lastExecutionAt = r.lastExecutionAt;
      map.set(key, v);
    }
  }
  return [...map.values()].sort((a, b) => b.totalElapsedMs - a.totalElapsedMs);
}

export type ViewCostDelta = ViewCost & {
  deltaExecutions: number | null;
  deltaElapsedMs: number | null;
  deltaCpuMs: number | null;
  deltaReads: number | null;
};

/**
 * Difference against the previous snapshot. When a counter goes down the plan was evicted and
 * recompiled: the current cumulative value is the best estimate of the work since then.
 */
export function viewCostDeltas(previous: ViewCost[] | null, current: ViewCost[]): ViewCostDelta[] {
  const prev = new Map((previous ?? []).map((v) => [`${v.databaseName}\u0000${v.viewName.toLowerCase()}`, v]));
  return current.map((v) => {
    if (!previous) return { ...v, deltaExecutions: null, deltaElapsedMs: null, deltaCpuMs: null, deltaReads: null };
    const p = prev.get(`${v.databaseName}\u0000${v.viewName.toLowerCase()}`);
    const d = (cur: number, old: number | undefined) => (old == null || cur < old ? cur : cur - old);
    const reset = p != null && v.executions < p.executions;
    return {
      ...v,
      deltaExecutions: reset ? v.executions : d(v.executions, p?.executions),
      deltaElapsedMs: reset ? v.totalElapsedMs : d(v.totalElapsedMs, p?.totalElapsedMs),
      deltaCpuMs: reset ? v.totalCpuMs : d(v.totalCpuMs, p?.totalCpuMs),
      deltaReads: reset ? v.totalReads : d(v.totalReads, p?.totalReads),
    };
  });
}

// ---------------------------------------------------------------------------
// Alerts (reuse system_metric_alert + subscribers; one key per incident)
// ---------------------------------------------------------------------------

const fmt = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

export function durationText(seconds: number): string {
  if (seconds < 120) return `${fmt(seconds)} s`;
  const min = seconds / 60;
  if (min < 120) return `${fmt(min)} min`;
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(min / 60)} h`;
}

function who(o: { hostName: string | null; loginName: string | null; programName: string | null }): string {
  const parts = [o.hostName && `equipo ${o.hostName}`, o.loginName && `usuario ${o.loginName}`, o.programName && `programa ${o.programName}`].filter(Boolean);
  return parts.length ? parts.join(', ') : 'origen desconocido';
}

export function evaluateSqlAlerts(observations: IncidentObservation[]): EarlyWarning[] {
  const t = SAP_THRESHOLDS.alert;
  const out: EarlyWarning[] = [];
  for (const o of observations) {
    const base = { key: o.key };
    if (o.kind === 'bloqueo' && o.seconds >= t.blockingSec) {
      out.push({
        ...base,
        rule: 'sap-bloqueo',
        severity: o.seconds >= t.blockingCriticalSec ? 'critical' : 'warning',
        title: `SAP: bloqueo de ${durationText(o.seconds)} en ${o.databaseName ?? 'SQL'}`,
        happening: `La sesión ${o.sessionId} (${who(o)}) tiene ${fmt(o.blocked ?? 0)} consulta(s) de SAP esperándola desde hace ${durationText(o.seconds)}.`,
        why: 'Casi siempre es una transacción que quedó abierta (una ventana de SAP en un documento sin terminar, una integración que no confirmó) o una consulta pesada que retiene bloqueos.',
        risk: 'Los usuarios de SAP y las apps (SAPSEND, SynerLink, Service Layer) quedan congelados en lo que toque esas tablas.',
        action: 'Revise en Monitor del sistema → Base de datos SAP quién es la cabeza del bloqueo y pídale a esa persona o equipo que termine o cancele. No mate sesiones sin validar con infraestructura.',
      });
    } else if (o.kind === 'consulta' && o.seconds >= t.queryWarningSec) {
      out.push({
        ...base,
        rule: 'sap-consulta',
        severity: o.seconds >= t.queryCriticalSec ? 'critical' : 'warning',
        title: `SAP: consulta corriendo hace ${durationText(o.seconds)}`,
        happening: `La sesión ${o.sessionId} (${who(o)}) lleva ${durationText(o.seconds)} con la misma consulta en ${o.databaseName ?? 'SQL'}.`,
        why: 'Suele ser una vista *B1SLQuery o un informe sin filtro de fecha, o una consulta esperando a un bloqueo.',
        risk: 'Consume CPU, memoria y disco del SQL de SAP y puede retener bloqueos sobre tablas de inventario o ventas.',
        action: 'Mire en Vistas SAP si es una vista llamada en bucle y quién la llama; ajuste el filtro o la frecuencia en el origen (Power BI, Power Automate, app).',
      });
    } else if (o.kind === 'transaccion' && o.seconds >= t.txWarningSec) {
      out.push({
        ...base,
        rule: 'sap-transaccion',
        severity: o.seconds >= t.txCriticalSec ? 'critical' : 'warning',
        title: `SAP: transacción abierta hace ${durationText(o.seconds)}`,
        happening: `La sesión ${o.sessionId} (${who(o)}) tiene una transacción abierta desde hace ${durationText(o.seconds)} en ${o.databaseName ?? 'SQL'}.`,
        why: 'El cliente de SAP o una integración empezó a grabar y no confirmó ni deshizo (ventana abierta, error sin manejar, sesión olvidada).',
        risk: 'Mientras siga abierta retiene bloqueos y el log de transacciones no se libera; cualquiera que toque lo mismo queda esperando.',
        action: 'Ubique el equipo y el usuario, pídale cerrar el documento o la ventana. Si no responde, infraestructura decide si se cierra la sesión.',
      });
    }
  }
  return out;
}

export type SlNodeSample = { service: string; pid: number; handles: number; memMb: number; threads: number | null; startedAt: string | null };

export function evaluateSlNodeAlerts(nodes: SlNodeSample[]): EarlyWarning[] {
  const t = SAP_THRESHOLDS.alert.slHandles;
  const out: EarlyWarning[] = [];
  for (const n of nodes) {
    if (n.handles < t.warning) continue;
    out.push({
      key: `sap-sl-handles:${n.service}:${n.pid}`,
      rule: 'sap-sl-handles',
      severity: n.handles >= t.critical ? 'critical' : 'warning',
      title: `Service Layer: nodo ${n.service} con ${fmt(n.handles)} handles`,
      happening: `El nodo ${n.service} (pid ${n.pid}) tiene ${fmt(n.handles)} handles y ${fmt(n.memMb)} MB de memoria.`,
      why: 'Sesiones del Service Layer que se abren y no se cierran (Login sin Logout), sobre todo de SAPSEND, se quedan vivas hasta 60 minutos.',
      risk: 'Con más de 6.000 handles los nodos se vuelven lentos: respuestas de 10 a 20 s y luego SAP congelado para OLP y las demás empresas.',
      action: 'Mire en la pestaña Service Layer qué IP y empresa tienen más logins sin logout. El reinicio de los servicios b1s500xx lo autoriza Nicolás y lo hace infraestructura.',
    });
  }
  return out;
}

export type SlViewWindowRow = { viewName: string; timeouts: number; calls: number; sources: string[]; maxMs: number };

export function evaluateViewTimeoutAlerts(rows: SlViewWindowRow[]): EarlyWarning[] {
  const t = SAP_THRESHOLDS.alert;
  return rows
    .filter((r) => r.timeouts >= t.viewTimeouts)
    .map((r) => ({
      key: `sap-vista-timeouts:${r.viewName}`.slice(0, 120),
      rule: 'sap-vista-timeouts' as const,
      severity: (r.timeouts >= t.viewTimeouts * 2 ? 'critical' : 'warning') as 'critical' | 'warning',
      title: `Vista SAP ${r.viewName}: ${fmt(r.timeouts)} timeouts en ${t.viewWindowMin} min`,
      happening: `En los últimos ${t.viewWindowMin} minutos la vista ${r.viewName} se llamó ${fmt(r.calls)} vez/veces y ${fmt(r.timeouts)} terminaron en timeout (502 o 300 s). Origen: ${r.sources.join(', ') || 'desconocido'}.`,
      why: 'La consulta de la vista tarda más que el límite del Service Layer (300 s) y quien la llama reintenta: cada reintento vuelve a cargar el SQL de SAP.',
      risk: 'Bloqueos sobre tablas de inventario y artículos (OITW, OITM) y lentitud general de SAP mientras dure el bucle.',
      action: 'Pida al dueño del origen (Power BI / Power Automate / app) pausar el reintento y acotar el filtro; revise el plan de la vista con infraestructura.',
    }));
}
