/**
 * Configuration of the SAP monitor. Everything is optional: without SAP_SQL_MONITOR_URL the SQL
 * probe never starts and the screen explains what is missing; without SAP_MONITOR_INGEST_KEYS the
 * Service Layer ingest answers 503.
 *
 *   SAP_SQL_MONITOR_URL     sqlserver://host:1433;database=master;user=...;password=...;encrypt=true;trustServerCertificate=true
 *                           (same shape as Prisma's DATABASE_URL; read-only login with VIEW SERVER STATE)
 *   SAP_MONITOR_ENABLED     'false' turns the SQL probe off even if the URL is set.
 *   SAP_MONITOR_INGEST_KEYS key(s) for POST /api/system-metrics/sap/ingest (comma separated).
 *   SAP_MONITOR_RETENTION_DAYS  default 30 (1–90).
 *   SAP_MONITOR_TEAMS_WEBHOOK_URL optional Teams "Workflows" webhook; alerts are also posted there.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export type SapSqlConfig = {
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
};

/** Parses `sqlserver://host:port;key=value;...` (Prisma style) or `Server=host,port;User Id=...;...` (ADO style). */
export function parseSqlConnectionString(raw: string | undefined | null): SapSqlConfig | null {
  const value = raw?.trim();
  if (!value) return null;
  const kv: Record<string, string> = {};
  let hostPart = '';
  if (/^sqlserver:\/\//i.test(value)) {
    const [hp, ...rest] = value.replace(/^sqlserver:\/\//i, '').split(';');
    hostPart = hp;
    for (const p of rest) {
      const i = p.indexOf('=');
      if (i > 0) kv[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim();
    }
  } else {
    for (const p of value.split(';')) {
      const i = p.indexOf('=');
      if (i > 0) kv[p.slice(0, i).trim().toLowerCase().replace(/\s+/g, '')] = p.slice(i + 1).trim();
    }
    hostPart = (kv.server ?? kv['datasource'] ?? '').replace(/^tcp:/i, '').replace(',', ':');
  }
  const [server, portText] = hostPart.split(':');
  const user = kv.user ?? kv.username ?? kv.userid ?? kv.uid;
  const password = kv.password ?? kv.pwd;
  if (!server || !user || !password) return null;
  const port = Number(portText || kv.port || 1433);
  const truthy = (v: string | undefined, fallback: boolean) => (v == null ? fallback : /^(true|yes|1)$/i.test(v));
  return {
    server,
    port: Number.isInteger(port) && port > 0 ? port : 1433,
    database: kv.database ?? kv.initialcatalog ?? 'master',
    user,
    password,
    encrypt: truthy(kv.encrypt, true),
    trustServerCertificate: truthy(kv.trustservercertificate, true),
  };
}

export function sapSqlConfig(): SapSqlConfig | null {
  return parseSqlConnectionString(process.env.SAP_SQL_MONITOR_URL);
}

export function isSapSqlMonitorEnabled(): boolean {
  if (process.env.SAP_MONITOR_ENABLED === 'false') return false;
  return sapSqlConfig() != null;
}

export function sapRetentionDays(): number {
  const n = Number(process.env.SAP_MONITOR_RETENTION_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : 30;
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

export function ingestKeys(): string[] {
  return (process.env.SAP_MONITOR_INGEST_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length >= 24);
}

/** Timing-safe check of the collector's Bearer key against SAP_MONITOR_INGEST_KEYS. */
export function isValidIngestKey(token: string | null | undefined): boolean {
  if (!token) return false;
  let ok = false;
  for (const key of ingestKeys()) if (safeEqual(token, key)) ok = true;
  return ok;
}
