/**
 * Joins the cost of each *B1SLQuery view in SQL (plan cache) with its calls through the Service
 * Layer (access log), by view name (case-insensitive). Pure: used by the «Vistas SAP» tab.
 */

export type ViewSqlRow = { databaseName: string; viewName: string; executions: number; elapsedMs: number; cpuMs: number; reads: number; maxElapsedMs: number; lastExecutionAt: string | null };
export type ViewSlRow = { viewName: string; sourceIp: string; company: string | null; calls: number; errors: number; timeouts: number; totalMs: number; maxMs: number; bytes: number; lastCall: string | null };

export type ViewRank = {
  viewName: string;
  databases: string[];
  slCalls: number;
  slTimeouts: number;
  slErrors: number;
  slTotalMs: number;
  slMaxMs: number;
  sqlExecutions: number;
  sqlElapsedMs: number;
  sqlCpuMs: number;
  sqlReads: number;
  sqlMaxMs: number;
  sources: Array<{ ip: string; calls: number; timeouts: number }>;
  lastSeen: string | null;
};

export function rankViews(data: { sql: ViewSqlRow[]; sl: ViewSlRow[] }): ViewRank[] {
  const map = new Map<string, ViewRank>();
  const get = (name: string) => {
    const key = name.toLowerCase();
    let v = map.get(key);
    if (!v) {
      v = { viewName: name, databases: [], slCalls: 0, slTimeouts: 0, slErrors: 0, slTotalMs: 0, slMaxMs: 0, sqlExecutions: 0, sqlElapsedMs: 0, sqlCpuMs: 0, sqlReads: 0, sqlMaxMs: 0, sources: [], lastSeen: null };
      map.set(key, v);
    }
    return v;
  };
  const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  for (const s of data.sql) {
    const v = get(s.viewName);
    if (!v.databases.includes(s.databaseName)) v.databases.push(s.databaseName);
    v.sqlExecutions += s.executions;
    v.sqlElapsedMs += s.elapsedMs;
    v.sqlCpuMs += s.cpuMs;
    v.sqlReads += s.reads;
    v.sqlMaxMs = Math.max(v.sqlMaxMs, s.maxElapsedMs);
    v.lastSeen = later(v.lastSeen, s.lastExecutionAt);
  }
  for (const s of data.sl) {
    const v = get(s.viewName);
    v.slCalls += s.calls;
    v.slTimeouts += s.timeouts;
    v.slErrors += s.errors;
    v.slTotalMs += s.totalMs;
    v.slMaxMs = Math.max(v.slMaxMs, s.maxMs);
    v.lastSeen = later(v.lastSeen, s.lastCall);
    const src = v.sources.find((x) => x.ip === s.sourceIp);
    if (src) {
      src.calls += s.calls;
      src.timeouts += s.timeouts;
    } else v.sources.push({ ip: s.sourceIp, calls: s.calls, timeouts: s.timeouts });
  }
  for (const v of map.values()) v.sources.sort((a, b) => b.calls - a.calls);
  return [...map.values()];
}

