import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import type { AuditScope } from "../chat/audit-access";
import { leerCorreosCorporativos } from "../portal/contactos";
import { leerBasePersonal } from "../portal/base-personal";
import {
  addWeeks,
  buildWeeklySeries,
  companyKey,
  fitAdoption,
  growthGap,
  m365Counts,
  normalizeArea,
  snapshotSeries,
  thCounts,
  weekRange,
  weekStart,
  type FitResult,
  type PersonRow,
  type SnapshotRow,
  type UserWeekRow,
  type WeekPoint,
} from "./adoption-model";

/**
 * AUDITORÍA DE AGENTES → ADOPCIÓN DE IA VS PLANTILLA (Nicolás Rivera, 2026-11-26).
 *
 * Sources (all READ-ONLY except the weekly snapshot insert):
 *   - KRONOSDB: `[user]` (createdAt, isActive), `user_audit_log` (DEACTIVATE), `company_user`, `department_user`,
 *     `chat_message` + `chat_conversation` (person messages to agents; kind 'project' = project turns).
 *     Reliable history starts 2026-09-07 (first chat message in production).
 *   - Microsoft 365 licensed people per tenant, through the existing read-only connectors
 *     (lib/portal/contactos.ts → `usuarios_licencia_activa`).
 *   - HR «BASE PERSONAL» (Talento Humano SharePoint, lib/portal/base-personal.ts): active people per company/area.
 * The last two have no history, so a snapshot per ISO week is stored in dbo.ai_headcount_snapshot
 * (prisma/manual/2026-11-26-auditoria-adopcion-ia-*.sql). Without that table the page still works and shows the
 * live value for the current week only.
 */

/** First week with chat usage in production (first chat_message, 2026-09-07). */
export const HISTORY_START = "2026-09-07";
const RAW_TTL_MS = 60 * 60_000;
const RESULT_TTL_MS = 6 * 60 * 60_000;

interface PersonWithOrg extends PersonRow {
  companies: number[];
  departments: number[];
}

interface RawData {
  people: PersonWithOrg[];
  usage: UserWeekRow[];
  companies: { id: number; name: string; key: string }[];
  departments: { id: number; name: string }[];
  snapshots: SnapshotRow[];
  snapshotsAvailable: boolean;
  live: { m365: Omit<SnapshotRow, "week">[] | null; th: Omit<SnapshotRow, "week">[] | null };
  loadedAt: number;
}

let rawCache: RawData | null = null;
const resultCache = new Map<string, { at: number; value: AdoptionDto }>();

const ids = (v: unknown) =>
  String(v ?? "")
    .split(",")
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0);
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));
const isMissingTable = (e: unknown) => [207, 208].includes((e as { number?: number } | null)?.number ?? 0);

async function readKronos(): Promise<Omit<RawData, "snapshots" | "snapshotsAvailable" | "live" | "loadedAt">> {
  const r = await withMssqlPool((pool) =>
    pool
      .request()
      .input("desde", sql.Date, HISTORY_START)
      .query(`
        SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
        SELECT u.id, u.createdAt, u.isActive, b.fecha AS deactivated_at,
               (SELECT STRING_AGG(CAST(cu.id_company AS varchar(12)), ',') FROM dbo.company_user cu WHERE cu.id_user = u.id) AS companies,
               (SELECT STRING_AGG(CAST(du.id_department AS varchar(12)), ',') FROM dbo.department_user du WHERE du.id_user = u.id) AS departments
        FROM dbo.[user] u
        LEFT JOIN (SELECT user_id, MAX(created_at) AS fecha FROM dbo.user_audit_log WHERE action = 'DEACTIVATE' GROUP BY user_id) b
          ON b.user_id = u.id
        WHERE u.role IN ('user', 'admin');

        -- Week = Monday (1900-01-01 was a Monday, so this does not depend on DATEFIRST).
        SELECT m.id_user_author AS id_user,
               DATEADD(day, -(DATEDIFF(day, '19000101', CAST(m.created_at AS date)) % 7), CAST(m.created_at AS date)) AS week,
               SUM(CASE WHEN c.kind = 'project' THEN 0 ELSE 1 END) AS chat_messages,
               SUM(CASE WHEN c.kind = 'project' THEN 1 ELSE 0 END) AS project_messages
        FROM dbo.chat_message m
        JOIN dbo.chat_conversation c ON c.id = m.id_conversation
        WHERE m.role = 'user' AND m.event_type IS NULL AND m.id_user_author IS NOT NULL
          AND c.kind IN ('direct', 'group', 'project') AND m.created_at >= @desde
        GROUP BY m.id_user_author,
                 DATEADD(day, -(DATEDIFF(day, '19000101', CAST(m.created_at AS date)) % 7), CAST(m.created_at AS date));

        SELECT id_company, RTRIM(company) AS company FROM dbo.company WHERE company <> 'PRUEBAS' ORDER BY company;
        SELECT id_department, department FROM dbo.department ORDER BY department;
      `),
  );
  const [p, u, c, d] = r.recordsets as unknown as Record<string, unknown>[][];
  return {
    people: p.map((x) => ({
      id: String(x.id),
      createdAt: new Date(x.createdAt as Date),
      isActive: Boolean(x.isActive),
      deactivatedAt: x.deactivated_at ? new Date(x.deactivated_at as Date) : null,
      companies: ids(x.companies),
      departments: ids(x.departments),
    })),
    usage: u.map((x) => ({
      idUser: String(x.id_user),
      week: day(x.week),
      chatMessages: Number(x.chat_messages) || 0,
      projectMessages: Number(x.project_messages) || 0,
    })),
    companies: c.map((x) => ({ id: Number(x.id_company), name: String(x.company), key: companyKey(String(x.company)) })),
    departments: d.map((x) => ({ id: Number(x.id_department), name: String(x.department) })),
  };
}

async function readSnapshots(): Promise<{ rows: SnapshotRow[]; available: boolean }> {
  try {
    const r = await withMssqlPool((pool) =>
      pool.request().query(`SELECT week_start, source, company_key, area, headcount FROM dbo.ai_headcount_snapshot`),
    );
    return {
      available: true,
      rows: r.recordset.map((x: Record<string, unknown>) => ({
        week: day(x.week_start),
        source: String(x.source) as SnapshotRow["source"],
        companyKey: String(x.company_key),
        area: String(x.area ?? ""),
        headcount: Number(x.headcount) || 0,
      })),
    };
  } catch (e) {
    if (isMissingTable(e)) return { rows: [], available: false };
    throw e;
  }
}

/** Live counts from Microsoft 365 and the HR base. Each source fails alone (null) without breaking the page. */
async function readLive(): Promise<RawData["live"]> {
  const [m365, th] = await Promise.all([
    leerCorreosCorporativos()
      .then((g) => {
        const rows = m365Counts(g);
        return rows.length ? rows : null;
      })
      .catch((e) => {
        console.warn("[auditoria/adopcion] M365:", (e as Error).message);
        return null;
      }),
    leerBasePersonal()
      .then((p) => thCounts(p))
      .catch((e) => {
        console.warn("[auditoria/adopcion] BASE PERSONAL:", (e as Error).message);
        return null;
      }),
  ]);
  return { m365, th };
}

/** One snapshot per source and week: inserts only the rows that are not there yet (idempotent). */
async function storeSnapshot(week: string, rows: Omit<SnapshotRow, "week">[]): Promise<void> {
  if (!rows.length) return;
  await withMssqlPool(async (pool) => {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const r of rows) {
        await new sql.Request(tx)
          .input("w", sql.Date, week)
          .input("s", sql.NVarChar(10), r.source)
          .input("k", sql.NVarChar(40), r.companyKey.slice(0, 40))
          .input("a", sql.NVarChar(120), r.area.slice(0, 120))
          .input("h", sql.Int, r.headcount)
          .query(`
            SET LOCK_TIMEOUT 5000;
            IF NOT EXISTS (SELECT 1 FROM dbo.ai_headcount_snapshot WHERE week_start = @w AND source = @s AND company_key = @k AND area = @a)
              INSERT INTO dbo.ai_headcount_snapshot (week_start, source, company_key, area, headcount) VALUES (@w, @s, @k, @a, @h);
          `);
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback().catch(() => undefined);
      throw e;
    }
  });
}

async function loadRaw(force: boolean): Promise<RawData> {
  if (!force && rawCache && Date.now() - rawCache.loadedAt < RAW_TTL_MS) return rawCache;
  const [kronos, snaps, live] = await Promise.all([readKronos(), readSnapshots(), readLive()]);
  const week = weekStart(new Date());
  let rows = snaps.rows;
  if (snaps.available) {
    for (const src of ["m365", "th"] as const) {
      const liveRows = live[src];
      if (!liveRows || rows.some((r) => r.week === week && r.source === src)) continue;
      try {
        await storeSnapshot(week, liveRows);
        rows = [...rows, ...liveRows.map((r) => ({ ...r, week }))];
      } catch (e) {
        console.warn(`[auditoria/adopcion] snapshot ${src}:`, (e as Error).message);
      }
    }
  }
  rawCache = { ...kronos, snapshots: rows, snapshotsAvailable: snaps.available, live, loadedAt: Date.now() };
  return rawCache;
}

export interface AdoptionFilters {
  companyId: number | null;
  departmentId: number | null;
}

export interface AdoptionPoint extends WeekPoint {
  m365: number | null;
  th: number | null;
}

export interface AdoptionDto {
  generatedAt: string;
  historyStart: string;
  /** Last COMPLETE week used in the series (the running week is left out). */
  lastWeek: string;
  companies: { id: number; name: string }[];
  departments: { id: number; name: string }[];
  filters: AdoptionFilters;
  series: AdoptionPoint[];
  fit: FitResult;
  kpis: {
    headcount: number;
    activeAi: number;
    activeRate: number | null;
    cumulativeAi: number;
    interactions: number;
    interactionsPerActive: number | null;
    gapPeople: number | null;
    gapInteractions: number | null;
    m365: number | null;
    th: number | null;
  };
  sources: {
    snapshotsAvailable: boolean;
    m365Live: boolean;
    thLive: boolean;
    firstSnapshotWeek: string | null;
  };
}

export async function readAdoption(scope: AuditScope, filters: AdoptionFilters, force = false): Promise<AdoptionDto> {
  const allowed = (id: number) => scope.all || scope.companyIds.includes(id);
  const companyId = filters.companyId !== null && allowed(filters.companyId) ? filters.companyId : null;
  const cacheKey = `${scope.all ? "all" : scope.companyIds.join(".")}|${companyId ?? "*"}|${filters.departmentId ?? "*"}`;
  const hit = resultCache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.value;
  if (force) resultCache.clear();

  const raw = await loadRaw(force);
  const companies = raw.companies.filter((c) => allowed(c.id));
  const companyIds = companyId !== null ? [companyId] : companies.map((c) => c.id);
  const department = filters.departmentId !== null ? raw.departments.find((d) => d.id === filters.departmentId) ?? null : null;

  const people = raw.people.filter(
    (p) => p.companies.some((c) => companyIds.includes(c)) && (!department || p.departments.includes(department.id)),
  );
  const lastWeek = addWeeks(weekStart(new Date()), -1);
  const weeks = weekRange(HISTORY_START, lastWeek);
  const series = buildWeeklySeries(weeks, people, raw.usage);

  // Snapshot sources: the current week's live value is shown even when the table is not there yet.
  const keys = scope.all && companyId === null ? null : [...new Set(companies.filter((c) => companyIds.includes(c.id)).map((c) => c.key))];
  const area = department ? normalizeArea(department.name) : null;
  const thisWeek = weekStart(new Date());
  const snapRows: SnapshotRow[] = raw.snapshotsAvailable
    ? raw.snapshots
    : [...(raw.live.m365 ?? []), ...(raw.live.th ?? [])].map((r) => ({ ...r, week: thisWeek }));
  const snapWeeks = [...weeks, thisWeek];
  const m365 = snapshotSeries(snapWeeks, snapRows, "m365", keys, area);
  const th = snapshotSeries(snapWeeks, snapRows, "th", keys, area);

  const points: AdoptionPoint[] = series.map((s, i) => ({ ...s, m365: m365[i], th: th[i] }));
  const firstUsed = points.findIndex((p) => p.cumulativeAi > 0);
  const fitted = firstUsed >= 0 ? points.slice(firstUsed) : [];
  const last = points[points.length - 1];
  const cap = Math.max(last?.headcount ?? 0, ...fitted.map((p) => p.cumulativeAi), 1);
  const fit = fitAdoption(fitted[0]?.week ?? HISTORY_START, fitted.map((p) => p.cumulativeAi), cap);

  const first = fitted[0];
  const latestOf = (xs: (number | null)[]) => [...xs].reverse().find((x) => x !== null) ?? null;
  const value: AdoptionDto = {
    generatedAt: new Date().toISOString(),
    historyStart: HISTORY_START,
    lastWeek,
    companies: companies.map(({ id, name }) => ({ id, name })),
    departments: raw.departments,
    filters: { companyId, departmentId: department?.id ?? null },
    series: points,
    fit,
    kpis: {
      headcount: last?.headcount ?? 0,
      activeAi: last?.activeAi ?? 0,
      activeRate: last?.activeRate ?? null,
      cumulativeAi: last?.cumulativeAi ?? 0,
      interactions: last?.interactions ?? 0,
      interactionsPerActive: last?.interactionsPerActive ?? null,
      gapPeople: first && last ? growthGap(first.activeAi, last.activeAi, first.headcount, last.headcount) : null,
      gapInteractions: first && last ? growthGap(first.interactions, last.interactions, first.headcount, last.headcount) : null,
      m365: latestOf(m365),
      th: latestOf(th),
    },
    sources: {
      snapshotsAvailable: raw.snapshotsAvailable,
      m365Live: raw.live.m365 !== null,
      thLive: raw.live.th !== null,
      firstSnapshotWeek: raw.snapshots.map((r) => r.week).sort()[0] ?? null,
    },
  };
  resultCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
