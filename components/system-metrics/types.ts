/** Tipos de las respuestas de /api/system-metrics/* (lado cliente). */

export type RangeKey = '1h' | '6h' | '24h' | '7d';

/** `long` va en títulos ("Las últimas 6 horas…"); `span` completa frases ("…en 6 horas"). */
export const RANGE_OPTIONS: Array<{ value: RangeKey; label: string; long: string; span: string }> = [
  { value: '1h', label: '1 h', long: 'La última hora', span: 'la última hora' },
  { value: '6h', label: '6 h', long: 'Las últimas 6 horas', span: '6 horas' },
  { value: '24h', label: '24 h', long: 'Las últimas 24 horas', span: '24 horas' },
  { value: '7d', label: '7 días', long: 'Los últimos 7 días', span: '7 días' },
];

export const BUCKET_MINUTES: Record<RangeKey, number> = { '1h': 1, '6h': 5, '24h': 15, '7d': 60 };
export const RANGE_MINUTES: Record<RangeKey, number> = { '1h': 60, '6h': 360, '24h': 1440, '7d': 10080 };

export type ProcessSeriesRow = {
  bucket: string;
  host: string;
  instance: string;
  cpuPct: number | null;
  rssMb: number | null;
  heapUsedMb: number | null;
  eventLoopP99Ms: number | null;
  hostCpuPct: number | null;
  hostMemUsedPct: number | null;
  httpRequests: number;
  httpErrors: number;
  httpP95Ms: number | null;
  outRequests: number;
  outErrors: number;
  outThrottled: number;
  poolBorrowed: number | null;
  poolPending: number | null;
  poolSize: number | null;
};

export type RouteRow = {
  key: string;
  module: string;
  moduleLabel?: string;
  label?: string;
  requests: number;
  errors: number;
  clientErrors: number;
  throttled: number;
  totalMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
};

export type ModuleRow = { module: string; label: string; requests: number; totalMs: number; errors: number };
export type ModuleSeriesRow = { bucket: string; module: string; label: string; requests: number; totalMs: number };

export type DbSeriesRow = {
  bucket: string;
  hasServerState: boolean;
  sqlCpuPct: number | null;
  otherCpuPct: number | null;
  userConnections: number | null;
  dbSessions: number | null;
  activeRequests: number | null;
  blockedRequests: number | null;
  longestWaitMs: number | null;
  dbSizeMb: number | null;
  logUsedPct: number | null;
};

export type PeriodSummary = {
  samples: number;
  requests: number;
  errors: number;
  p95Ms: number | null;
  hostCpuPct: number | null;
  hostMemUsedPct: number | null;
  maxRssMb: number | null;
  maxEventLoopP99Ms: number | null;
  outRequests: number;
  outErrors: number;
  outThrottled: number;
  maxPoolPending: number | null;
};

export type CollectorStatus = {
  enabled: boolean;
  host: string;
  instance: string;
  pausedReason: string | null;
  lastFlushAt: string | null;
  lastError: string | null;
};

export type ProcessLifetime = { host: string; instance: string; pid: number; firstSeen: string; lastSeen: string };

export type MetricsResponse = {
  range: RangeKey;
  status: CollectorStatus;
  tablesMissing: boolean;
  processSeries: ProcessSeriesRow[];
  inbound: RouteRow[];
  outbound: RouteRow[];
  modules: ModuleRow[];
  db: DbSeriesRow[];
  summary: { current: PeriodSummary; previous: PeriodSummary } | null;
  moduleSeries: ModuleSeriesRow[];
  lifetimes: ProcessLifetime[];
};

export type DbLive = {
  hasServerState: boolean;
  queryStore: string | null;
  sqlServerStartedAt: string | null;
  cachedAt: string;
  connections: Array<{ hostName: string; programName: string; loginName: string; sessions: number; running: number }>;
  blocked: Array<{
    sessionId: number;
    blockingSessionId: number;
    waitType: string | null;
    waitMs: number;
    command: string | null;
    hostName: string | null;
    programName: string | null;
    statement: string | null;
  }>;
  topQueries: Array<{
    statement: string;
    executions: number;
    totalCpuMs: number;
    avgCpuMs: number;
    avgElapsedMs: number;
    avgLogicalReads: number;
    lastExecution: string | null;
  }>;
};

/** Lo que abre la hoja de detalle. */
export type DetailTarget =
  | { kind: 'module'; label: string }
  | { kind: 'route'; direction: 'in' | 'out'; key: string; title: string };
