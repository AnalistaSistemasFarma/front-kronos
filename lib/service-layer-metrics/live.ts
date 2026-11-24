import type { PrismaClient } from '../../app/generated/prisma';
import { getSapLiveStats, sapMetricKey, type SapEndpointLiveStats } from '../sap/callMetrics';
import os from 'node:os';

export type CompanySlStatus = 'ok' | 'warning' | 'critical' | 'idle' | 'inactive';

export type CompanySlRow = {
  idCompany: number;
  company: string;
  endpointName: string;
  host: string;
  companyDB: string;
  isActive: boolean;
  status: CompanySlStatus;
  inflight: number;
  peakInflight: number;
  openSessions: number;
  /** Llamadas en los últimos ~5 minutos desde esta instancia. */
  requests5m: number;
  errors5m: number;
  p95Ms: number | null;
  lastAt: number | null;
  lastStatus: number | null;
  /** true si hubo tráfico/métricas en esta instancia para este endpoint. */
  hasTraffic: boolean;
};

export type ServiceLayerLiveSnapshot = {
  sampledAt: string;
  host: string;
  pid: number;
  note: string;
  totals: {
    companies: number;
    activeEndpoints: number;
    inflight: number;
    openSessions: number;
    requests5m: number;
    errors5m: number;
    ok: number;
    warning: number;
    critical: number;
    idle: number;
    inactive: number;
  };
  companies: CompanySlRow[];
};

function hostOfBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).host.toLowerCase();
  } catch {
    return baseUrl.toLowerCase();
  }
}

function statusOf(row: {
  isActive: boolean;
  hasTraffic: boolean;
  inflight: number;
  openSessions: number;
  requests5m: number;
  errors5m: number;
  p95Ms: number | null;
  lastStatus: number | null;
}): CompanySlStatus {
  if (!row.isActive) return 'inactive';
  if (!row.hasTraffic && row.inflight === 0 && row.openSessions === 0) return 'idle';

  const errorRate = row.requests5m > 0 ? row.errors5m / row.requests5m : 0;
  if (errorRate >= 0.4 || (row.lastStatus != null && row.lastStatus === 0)) return 'critical';
  if (errorRate >= 0.15 || (row.p95Ms != null && row.p95Ms >= 8000) || row.inflight >= 8) return 'warning';
  if (row.requests5m > 0 || row.inflight > 0 || row.openSessions > 0) return 'ok';
  return 'idle';
}

function matchStats(
  stats: SapEndpointLiveStats[],
  host: string,
  companyDB: string
): SapEndpointLiveStats | null {
  const key = sapMetricKey(host, companyDB);
  return stats.find((s) => s.key === key) ?? null;
}

/**
 * Foto en vivo: todas las empresas con sap_endpoints + métricas de esta
 * instancia Node (concurrencia/latencia de lib/sap/callMetrics).
 */
export async function buildServiceLayerLiveSnapshot(
  prisma: PrismaClient
): Promise<ServiceLayerLiveSnapshot> {
  const endpoints = await prisma.sap_endpoints.findMany({
    select: {
      id_sap_endpoint: true,
      endpoint_name: true,
      base_url: true,
      client: true,
      is_active: true,
      company: { select: { id_company: true, company: true } },
    },
    orderBy: [{ company: { company: 'asc' } }, { endpoint_name: 'asc' }],
  });

  const live = getSapLiveStats();
  const companies: CompanySlRow[] = endpoints.map((ep) => {
    const host = hostOfBaseUrl(ep.base_url);
    const companyDB = (ep.client || '').trim() || '(sin-db)';
    const m = matchStats(live, host, companyDB);
    const hasTraffic = Boolean(m && (m.requests > 0 || m.inflight > 0 || m.openSessions > 0));
    const base = {
      isActive: ep.is_active,
      hasTraffic,
      inflight: m?.inflight ?? 0,
      openSessions: m?.openSessions ?? 0,
      requests5m: m?.requests ?? 0,
      errors5m: m?.errors ?? 0,
      p95Ms: m?.p95Ms ?? null,
      lastStatus: m?.lastStatus ?? null,
    };
    return {
      idCompany: ep.company.id_company,
      company: ep.company.company.trim(),
      endpointName: ep.endpoint_name,
      host,
      companyDB,
      isActive: ep.is_active,
      status: statusOf(base),
      inflight: base.inflight,
      peakInflight: m?.peakInflight ?? 0,
      openSessions: base.openSessions,
      requests5m: base.requests5m,
      errors5m: base.errors5m,
      p95Ms: base.p95Ms,
      lastAt: m?.lastAt ?? null,
      lastStatus: base.lastStatus,
      hasTraffic,
    };
  });

  const totals = {
    companies: new Set(companies.map((c) => c.idCompany)).size,
    activeEndpoints: companies.filter((c) => c.isActive).length,
    inflight: companies.reduce((a, c) => a + c.inflight, 0),
    openSessions: companies.reduce((a, c) => a + c.openSessions, 0),
    requests5m: companies.reduce((a, c) => a + c.requests5m, 0),
    errors5m: companies.reduce((a, c) => a + c.errors5m, 0),
    ok: companies.filter((c) => c.status === 'ok').length,
    warning: companies.filter((c) => c.status === 'warning').length,
    critical: companies.filter((c) => c.status === 'critical').length,
    idle: companies.filter((c) => c.status === 'idle').length,
    inactive: companies.filter((c) => c.status === 'inactive').length,
  };

  return {
    sampledAt: new Date().toISOString(),
    host: os.hostname(),
    pid: process.pid,
    note:
      'Concurrencia y latencia de esta instancia de SynerLink hacia cada Service Layer (últimos 5 min). Con pm2 en cluster, cada proceso tiene su propio contador.',
    totals,
    companies,
  };
}
