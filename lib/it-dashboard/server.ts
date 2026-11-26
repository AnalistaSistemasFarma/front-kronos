/**
 * Dashboard TI - server panel (asset detail window, assets whose type is a
 * server). Pure helpers: type detection, network data validation and the
 * shape of the performance block. DB access lives in serverDb.ts.
 */

/** True for asset types that are servers (type_asset «SERVIDOR»). */
export function isServerType(typeName: string | null | undefined): boolean {
  const key = (typeName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /servidor|server/.test(key);
}

/** Editable «Datos de red» of a server (table asset_server_network). */
export interface ServerNetwork {
  hostname: string;
  ipAddress: string;
  subnetMask: string;
  gateway: string;
  dnsServers: string;
  vlan: string;
  macAddress: string;
  notes: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const EMPTY_NETWORK: ServerNetwork = {
  hostname: '',
  ipAddress: '',
  subnetMask: '',
  gateway: '',
  dnsServers: '',
  vlan: '',
  macAddress: '',
  notes: '',
  updatedAt: null,
  updatedBy: null,
};

export type ServerNetworkInput = Omit<ServerNetwork, 'updatedAt' | 'updatedBy'>;

export const NETWORK_FIELD_LIMITS: Record<keyof ServerNetworkInput, number> = {
  hostname: 100,
  ipAddress: 45,
  subnetMask: 45,
  gateway: 45,
  dnsServers: 200,
  vlan: 50,
  macAddress: 30,
  notes: 1000,
};

export const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;
const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9_.\-]*[A-Za-z0-9])?$/;
const MAC = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
/** CIDR prefix written as «/24» or «24». */
export const CIDR = /^\/?([0-9]|[12]\d|3[0-2])$/;

export function isIpAddress(value: string): boolean {
  const v = value.trim();
  return IPV4.test(v) || (v.includes(':') && IPV6.test(v));
}

export type NetworkValidation =
  | { ok: true; value: ServerNetworkInput }
  | { ok: false; errors: Partial<Record<keyof ServerNetworkInput, string>> };

const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Validates the body of PUT /api/it-dashboard/assets/[id]/server. Empty fields are allowed. */
export function validateNetworkInput(body: unknown): NetworkValidation {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const value: ServerNetworkInput = {
    hostname: asText(src.hostname),
    ipAddress: asText(src.ipAddress),
    subnetMask: asText(src.subnetMask),
    gateway: asText(src.gateway),
    dnsServers: asText(src.dnsServers),
    vlan: asText(src.vlan),
    macAddress: asText(src.macAddress),
    notes: asText(src.notes),
  };
  const errors: Partial<Record<keyof ServerNetworkInput, string>> = {};

  for (const key of Object.keys(NETWORK_FIELD_LIMITS) as Array<keyof ServerNetworkInput>) {
    if (value[key].length > NETWORK_FIELD_LIMITS[key]) {
      errors[key] = `Máximo ${NETWORK_FIELD_LIMITS[key]} caracteres`;
    }
  }
  if (value.hostname && !errors.hostname && !HOSTNAME.test(value.hostname)) {
    errors.hostname = 'Solo letras, números, guiones y puntos';
  }
  if (value.ipAddress && !errors.ipAddress && !isIpAddress(value.ipAddress)) {
    errors.ipAddress = 'Dirección IP no válida';
  }
  if (value.subnetMask && !errors.subnetMask && !IPV4.test(value.subnetMask) && !CIDR.test(value.subnetMask)) {
    errors.subnetMask = 'Use 255.255.255.0 o /24';
  }
  if (value.gateway && !errors.gateway && !isIpAddress(value.gateway)) {
    errors.gateway = 'Dirección IP no válida';
  }
  if (value.dnsServers && !errors.dnsServers) {
    const bad = value.dnsServers
      .split(/[,;\s]+/)
      .filter(Boolean)
      .some((ip) => !isIpAddress(ip));
    if (bad) errors.dnsServers = 'Separe las IP con comas';
  }
  if (value.macAddress && !errors.macAddress && !MAC.test(value.macAddress)) {
    errors.macAddress = 'Formato AA:BB:CC:DD:EE:FF';
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** Name used to find the server in system_metric_sample: first label of the hostname, upper case. */
export function metricsHostKey(hostname: string | null | undefined): string | null {
  const first = (hostname ?? '').trim().split('.')[0]?.trim().toUpperCase();
  return first ? first : null;
}

export interface ServerPerformance {
  /** «live»: sample in the last 10 minutes; «stale»: older; «none»: never reported or no hostname. */
  state: 'live' | 'stale' | 'none';
  host: string | null;
  lastSampleAt: string | null;
  cpuPct: number | null;
  memPct: number | null;
  memTotalMb: number | null;
  cpuAvg24h: number | null;
  cpuMax24h: number | null;
  memAvg24h: number | null;
  memMax24h: number | null;
}

export const LIVE_WINDOW_MINUTES = 10;

const num = (v: unknown) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

export function buildPerformance(
  host: string | null,
  last: { sampledAt: Date | string | null; cpu: unknown; mem: unknown; memTotalMb: unknown } | null,
  day: { cpuAvg: unknown; cpuMax: unknown; memAvg: unknown; memMax: unknown } | null,
  now: Date = new Date()
): ServerPerformance {
  const empty: ServerPerformance = {
    state: 'none',
    host,
    lastSampleAt: null,
    cpuPct: null,
    memPct: null,
    memTotalMb: null,
    cpuAvg24h: null,
    cpuMax24h: null,
    memAvg24h: null,
    memMax24h: null,
  };
  if (!host || !last?.sampledAt) return empty;
  const at = new Date(last.sampledAt);
  if (Number.isNaN(at.getTime())) return empty;
  const ageMin = (now.getTime() - at.getTime()) / 60000;
  return {
    state: ageMin <= LIVE_WINDOW_MINUTES ? 'live' : 'stale',
    host,
    lastSampleAt: at.toISOString(),
    cpuPct: num(last.cpu),
    memPct: num(last.mem),
    memTotalMb: num(last.memTotalMb),
    cpuAvg24h: num(day?.cpuAvg),
    cpuMax24h: num(day?.cpuMax),
    memAvg24h: num(day?.memAvg),
    memMax24h: num(day?.memMax),
  };
}
