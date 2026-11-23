import 'server-only';
import { sql } from '@/lib/mssqlPool';
import { statusGroupOf } from './listFilters';
import {
  SLA_RUNNING_STATUSES,
  bogotaWallNow,
  evaluateSla,
  formatSla,
  type SlaPause,
  type SlaState,
} from './sla';
import { countInboxSla, type InboxSlaBreakdown, type InboxSlaCounts, type InboxSlaItem } from './slaInbox';

/**
 * SLA (ANS) of the assigned-requests inbox of the user. The scope is EXACTLY the inbox:
 *   - requests of the processes or categories the user manages (`request-assigned`), and
 *   - tasks assigned to the user (`activities-assigned`),
 * both without the closed states (2 Resuelto, 3 Cancelado). Counters are per inbox row
 * (`countInboxSla`), so they add up to the «Pendientes» card and match the card filter.
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
  /** Pending inbox rows (requests + tasks) per bucket; they add up to `total`. */
  counts: InboxSlaCounts;
  breakdown: InboxSlaBreakdown;
  total: number;
  /** SLA of every request whose clock runs (1, 4, 5). Missing request = clock stopped. */
  byRequest: Record<number, RequestSlaInfo>;
}

/** Closed states excluded from the inbox «Pendientes» scope. */
const CLOSED_STATUSES = '2, 3';

/** Inbox rows of the user (same predicates as `request-assigned` and `activities-assigned`). */
export const INBOX_ITEMS_SQL = (companyClause: string) => `
  SELECT 'request' AS kind, rg.id AS request_id, rg.status_req AS status_id, sc.status AS status_name
  FROM requests_general rg
  INNER JOIN company c ON c.id_company = rg.id_company
  INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
  LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
  INNER JOIN category_request cr ON cr.id = pc.id_category_request
  INNER JOIN status_case sc ON sc.id_status_case = rg.status_req
  WHERE rg.status_req NOT IN (${CLOSED_STATUSES})${companyClause}
    AND (
      EXISTS (SELECT 1 FROM user_process_category_request_general upcrg
              WHERE upcrg.id_process_category = pc.id AND upcrg.id_user = @idUser)
      OR EXISTS (SELECT 1 FROM user_category_request_general ucrg
                 WHERE ucrg.id_category = cr.id AND ucrg.id_user = @idUser)
    )
  UNION ALL
  SELECT 'task' AS kind, trg.id_request_general AS request_id, trg.id_status AS status_id, sc.status AS status_name
  FROM task_request_general trg
  INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
  LEFT JOIN requests_general rg ON rg.id = trg.id_request_general
  INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
  INNER JOIN [user] u ON u.id = trg.id_assigned
  INNER JOIN [user] urq ON urq.id = rg.id_requester
  INNER JOIN company c ON c.id_company = rg.id_company
  WHERE trg.id_assigned = @idUser AND trg.id_status NOT IN (${CLOSED_STATUSES})${companyClause}
`;

const emptySummary = (available: boolean): SlaScopeSummary => ({
  available,
  ...countInboxSla([], {}),
  byRequest: {},
});

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
  let items: InboxSlaItem[];
  let rows: Array<{
    id: number;
    created_at: Date;
    status_req: number;
    sla_value: number | null;
    sla_unit: string | null;
    sla_warn_pct: number | null;
  }>;
  try {
    const itemRows = (await req.query(INBOX_ITEMS_SQL(companyClause))).recordset as Array<{
      kind: 'request' | 'task';
      request_id: number | null;
      status_id: number;
      status_name: string | null;
    }>;
    items = itemRows.map((r) => ({
      kind: r.kind,
      requestId: r.request_id,
      group: statusGroupOf(r.status_id, r.status_name),
    }));
    const ids = [...new Set(itemRows.map((r) => r.request_id).filter((id): id is number => id != null))];
    rows = ids.length
      ? (
          await pool
            .request()
            .input('ids', sql.NVarChar(sql.MAX), JSON.stringify(ids))
            .query(`
              SELECT rg.id, rg.created_at, rg.status_req, pc.sla_value, pc.sla_unit, pc.sla_warn_pct
              FROM requests_general rg
              LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
              LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
              WHERE rg.id IN (SELECT CAST([value] AS INT) FROM OPENJSON(@ids))
                AND rg.status_req IN (${SLA_RUNNING_STATUSES.join(', ')})
            `)
        ).recordset
      : [];
  } catch (e) {
    if (isMissingSchema(e)) return emptySummary(false);
    throw e;
  }

  const byRequest = await buildSlaByRequest(pool, rows, opts.now);
  return { available: true, ...countInboxSla(items, byRequest), byRequest };
}

export interface SlaRequestRow {
  id: number;
  created_at: Date;
  status_req: number;
  sla_value: number | null;
  sla_unit: string | null;
  sla_warn_pct: number | null;
}

/**
 * SLA of each request whose clock runs (status 1, 4, 5); other rows are left out, which the
 * bucket functions read as «paused». Loads the pauses of the requests that have an SLA.
 */
export async function buildSlaByRequest(
  pool: sql.ConnectionPool,
  allRows: SlaRequestRow[],
  nowInput?: Date
): Promise<Record<number, RequestSlaInfo>> {
  const running = new Set<number>(SLA_RUNNING_STATUSES);
  const rows = allRows.filter((r) => running.has(Number(r.status_req)));
  const byRequest: Record<number, RequestSlaInfo> = {};

  // Pauses only matter for requests that have an SLA.
  const withSla = rows.filter((r) => r.sla_value != null).map((r) => r.id);
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

  const now = bogotaWallNow(nowInput);
  for (const r of rows) {
    const cfg = { value: r.sla_value, unit: r.sla_unit, warnPct: r.sla_warn_pct };
    const ev = evaluateSla(r.created_at, cfg, now, pauses.get(r.id) ?? []);
    byRequest[r.id] = {
      state: ev.state,
      remainingHours: ev.remainingHours == null ? null : Math.round(ev.remainingHours * 10) / 10,
      slaHours: ev.slaHours,
      slaLabel: formatSla(cfg),
    };
  }
  return byRequest;
}
