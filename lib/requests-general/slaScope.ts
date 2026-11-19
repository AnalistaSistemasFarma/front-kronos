import 'server-only';
import { sql } from '@/lib/mssqlPool';
import {
  REQUEST_RETURNED_STATUS,
  SLA_RUNNING_STATUSES,
  bogotaWallNow,
  evaluateSla,
  formatSla,
  type SlaPause,
  type SlaState,
} from './sla';

/**
 * SLA (ANS) of the open requests in the user's scope: requests of the processes or
 * categories the user manages (same scope as `request-assigned` and `dashboard-solicitado`).
 */

export interface RequestSlaInfo {
  state: SlaState;
  remainingHours: number | null;
  slaHours: number | null;
  slaLabel: string;
}

export interface SlaScopeSummary {
  /** false when the SLA columns do not exist yet in this database. */
  available: boolean;
  counts: Record<SlaState, number> & { returned: number };
  byRequest: Record<number, RequestSlaInfo>;
}

const emptyCounts = () => ({ overdue: 0, near_due: 0, on_time: 0, no_sla: 0, returned: 0 });

/** SQL Server "invalid column/object name": the manual migration is not applied yet. */
const isMissingSchema = (e: unknown) => {
  const n = (e as { number?: number })?.number;
  return n === 207 || n === 208;
};

export async function loadSlaScope(
  pool: sql.ConnectionPool,
  idUser: string,
  opts: { company?: number | null; now?: Date } = {}
): Promise<SlaScopeSummary> {
  const req = pool.request().input('idUser', sql.NVarChar(255), idUser);
  let companyClause = '';
  if (opts.company && Number.isInteger(opts.company)) {
    companyClause = ' AND rg.id_company = @company';
    req.input('company', sql.Int, opts.company);
  }
  const running = SLA_RUNNING_STATUSES.join(', ');
  let rows: Array<{
    id: number;
    created_at: Date;
    status_req: number;
    sla_value: number | null;
    sla_unit: string | null;
    sla_warn_pct: number | null;
  }>;
  try {
    const result = await req.query(`
      SELECT rg.id, rg.created_at, rg.status_req, pc.sla_value, pc.sla_unit, pc.sla_warn_pct
      FROM requests_general rg
      INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
      INNER JOIN process_category pc ON pc.id = pcrg.id_process_category
      WHERE rg.status_req IN (${running}, ${REQUEST_RETURNED_STATUS})${companyClause}
        AND (
          EXISTS (SELECT 1 FROM user_process_category_request_general upcrg
                  WHERE upcrg.id_process_category = pc.id AND upcrg.id_user = @idUser)
          OR EXISTS (SELECT 1 FROM user_category_request_general ucrg
                     WHERE ucrg.id_category = pc.id_category_request AND ucrg.id_user = @idUser)
        )
    `);
    rows = result.recordset;
  } catch (e) {
    if (isMissingSchema(e)) return { available: false, counts: emptyCounts(), byRequest: {} };
    throw e;
  }

  const counts = emptyCounts();
  const byRequest: Record<number, RequestSlaInfo> = {};
  const running_rows = rows.filter((r) => r.status_req !== REQUEST_RETURNED_STATUS);
  counts.returned = rows.length - running_rows.length;

  // Pauses only matter for requests that have an SLA.
  const withSla = running_rows.filter((r) => r.sla_value != null).map((r) => r.id);
  const pauses = new Map<number, SlaPause[]>();
  if (withSla.length) {
    const p = await pool
      .request()
      .input('ids', sql.NVarChar(sql.MAX), JSON.stringify(withSla))
      .query(`
        SELECT id_request_general, paused_at, resumed_at
        FROM request_sla_pause
        WHERE id_request_general IN (SELECT CAST([value] AS INT) FROM OPENJSON(@ids))
      `);
    for (const r of p.recordset as Array<{ id_request_general: number; paused_at: Date; resumed_at: Date | null }>) {
      const list = pauses.get(r.id_request_general) ?? [];
      list.push({ pausedAt: r.paused_at, resumedAt: r.resumed_at });
      pauses.set(r.id_request_general, list);
    }
  }

  const now = bogotaWallNow(opts.now);
  for (const r of running_rows) {
    const cfg = { value: r.sla_value, unit: r.sla_unit, warnPct: r.sla_warn_pct };
    const ev = evaluateSla(r.created_at, cfg, now, pauses.get(r.id) ?? []);
    counts[ev.state] += 1;
    byRequest[r.id] = {
      state: ev.state,
      remainingHours: ev.remainingHours == null ? null : Math.round(ev.remainingHours * 10) / 10,
      slaHours: ev.slaHours,
      slaLabel: formatSla(cfg),
    };
  }
  return { available: true, counts, byRequest };
}
