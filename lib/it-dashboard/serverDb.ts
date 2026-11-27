import { prisma } from '../prisma';
import {
  EMPTY_NETWORK,
  buildPerformance,
  metricsHostKey,
  type ServerNetwork,
  type ServerNetworkInput,
  type ServerPerformance,
} from './server';

/**
 * Dashboard TI - server panel data.
 * - Network data: table asset_server_network (one row per asset), see
 *   prisma/manual/2026-11-26-it-dashboard-server-network-*.sql.
 * - Performance: the latest system_metric_sample of the host whose name
 *   matches the server hostname (servers that run the SynerLink collector).
 */

/** Asset type name, or null when the asset does not exist. */
export async function loadAssetTypeName(assetId: number): Promise<{ type: string | null } | null> {
  const rows = await prisma.$queryRaw<Array<{ type: string | null }>>`
    SELECT ta.type_asset AS type
    FROM assets a
    LEFT JOIN subtype_asset sa ON sa.id = a.id_subtype_asset
    LEFT JOIN type_asset ta ON ta.id = sa.id_type_asset
    WHERE a.id = ${assetId}
  `;
  return rows[0] ?? null;
}

type NetworkRow = {
  hostname: string | null;
  ip_address: string | null;
  subnet_mask: string | null;
  gateway: string | null;
  dns_servers: string | null;
  vlan: string | null;
  mac_address: string | null;
  notes: string | null;
  updated_at: Date | null;
  updated_by: string | null;
};

function toNetwork(row: NetworkRow | undefined): ServerNetwork {
  if (!row) return { ...EMPTY_NETWORK };
  return {
    hostname: row.hostname ?? '',
    ipAddress: row.ip_address ?? '',
    subnetMask: row.subnet_mask ?? '',
    gateway: row.gateway ?? '',
    dnsServers: row.dns_servers ?? '',
    vlan: row.vlan ?? '',
    macAddress: row.mac_address ?? '',
    notes: row.notes ?? '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy: row.updated_by ?? null,
  };
}

export async function loadServerNetwork(assetId: number): Promise<ServerNetwork> {
  const rows = await prisma.$queryRaw<NetworkRow[]>`
    SELECT hostname, ip_address, subnet_mask, gateway, dns_servers, vlan, mac_address, notes, updated_at, updated_by
    FROM asset_server_network
    WHERE id_asset = ${assetId}
  `;
  return toNetwork(rows[0]);
}

const orNull = (v: string) => (v ? v : null);

export async function saveServerNetwork(assetId: number, input: ServerNetworkInput, updatedBy: string): Promise<ServerNetwork> {
  await prisma.$executeRaw`
    MERGE asset_server_network WITH (HOLDLOCK) AS t
    USING (SELECT ${assetId} AS id_asset) AS s ON t.id_asset = s.id_asset
    WHEN MATCHED THEN UPDATE SET
      hostname = ${orNull(input.hostname)},
      ip_address = ${orNull(input.ipAddress)},
      subnet_mask = ${orNull(input.subnetMask)},
      gateway = ${orNull(input.gateway)},
      dns_servers = ${orNull(input.dnsServers)},
      vlan = ${orNull(input.vlan)},
      mac_address = ${orNull(input.macAddress)},
      notes = ${orNull(input.notes)},
      updated_at = SYSUTCDATETIME(),
      updated_by = ${updatedBy}
    WHEN NOT MATCHED THEN INSERT
      (id_asset, hostname, ip_address, subnet_mask, gateway, dns_servers, vlan, mac_address, notes, updated_at, updated_by)
      VALUES (${assetId}, ${orNull(input.hostname)}, ${orNull(input.ipAddress)}, ${orNull(input.subnetMask)},
              ${orNull(input.gateway)}, ${orNull(input.dnsServers)}, ${orNull(input.vlan)}, ${orNull(input.macAddress)},
              ${orNull(input.notes)}, SYSUTCDATETIME(), ${updatedBy});
  `;
  return loadServerNetwork(assetId);
}

export async function loadServerPerformance(hostname: string | null): Promise<ServerPerformance> {
  const host = metricsHostKey(hostname);
  if (!host) return buildPerformance(null, null, null);

  const last = await prisma.$queryRaw<
    Array<{ sampledAt: Date; cpu: unknown; mem: unknown; memTotalMb: unknown }>
  >`
    SELECT TOP 1
      s.sampled_at AS sampledAt,
      AVG(CAST(s.host_cpu_pct AS float)) OVER (PARTITION BY s.sampled_at) AS cpu,
      AVG(CAST(s.host_mem_used_pct AS float)) OVER (PARTITION BY s.sampled_at) AS mem,
      s.host_mem_total_mb AS memTotalMb
    FROM system_metric_sample s WITH (NOLOCK)
    WHERE UPPER(s.host) = ${host}
      AND s.sampled_at >= DATEADD(day, -7, SYSUTCDATETIME())
    ORDER BY s.sampled_at DESC
  `;
  if (!last[0]) return buildPerformance(host, null, null);

  const day = await prisma.$queryRaw<Array<{ cpuAvg: unknown; cpuMax: unknown; memAvg: unknown; memMax: unknown }>>`
    SELECT
      AVG(CAST(host_cpu_pct AS float)) AS cpuAvg,
      MAX(CAST(host_cpu_pct AS float)) AS cpuMax,
      AVG(CAST(host_mem_used_pct AS float)) AS memAvg,
      MAX(CAST(host_mem_used_pct AS float)) AS memMax
    FROM system_metric_sample WITH (NOLOCK)
    WHERE UPPER(host) = ${host}
      AND sampled_at >= DATEADD(hour, -24, SYSUTCDATETIME())
  `;
  return buildPerformance(host, last[0], day[0] ?? null);
}
