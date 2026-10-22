/**
 * Consulta de la auditoría de inicios de sesión (servidor, SOLO LECTURA).
 *
 * «Fallos seguidos»: para cada intento fallido se cuenta cuántos fallos lleva
 * el MISMO correo/NIT desde su último ingreso exitoso (islas con funciones de
 * ventana). La cuenta mira también el día anterior al rango para no perder una
 * racha que empezó justo antes.
 */
import 'server-only';
import { Prisma } from '../../../app/generated/prisma';
import { prisma } from '../../prisma';
import {
  COUNTRY_FILTER_INTERNAL,
  COUNTRY_FILTER_UNKNOWN,
  FAIL_STREAK_ALERT,
  HOME_COUNTRY_CODE,
} from './constants';
import { escapeLike, type LoginAuditFilters } from './filters';

export interface LoginAuditRow {
  id: number;
  attemptedAt: string;
  provider: string;
  identifier: string | null;
  userId: string | null;
  userName: string | null;
  success: boolean;
  failureReason: string | null;
  clientIp: string | null;
  ipScope: string;
  countryCode: string | null;
  countryName: string | null;
  region: string | null;
  city: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  companies: string | null;
  failStreak: number;
  outsideHome: boolean;
}

export interface LoginAuditSummary {
  total: number;
  failed: number;
  outsideHome: number;
  streakAlerts: number;
}

export interface LoginAuditPage {
  rows: LoginAuditRow[];
  summary: LoginAuditSummary;
  pagination: { page: number; limit: number; total: number; pages: number };
}

type RawRow = {
  id: number;
  attempted_at: Date;
  provider: string;
  identifier: string | null;
  id_user: string | null;
  user_name: string | null;
  success: boolean;
  failure_reason: string | null;
  client_ip: string | null;
  ip_scope: string;
  country_code: string | null;
  country_name: string | null;
  region: string | null;
  city: string | null;
  user_agent: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  companies: string | null;
  fail_streak: number | bigint;
  outside_home: number | boolean;
  total_count: number | bigint;
  failed_count: number | bigint;
  outside_count: number | bigint;
  streak_count: number | bigint;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Expresión SQL «fuera de Colombia»: IP pública con país conocido distinto de CO. */
const OUTSIDE_SQL = Prisma.sql`(s.ip_scope = N'PUBLICA' AND s.country_code IS NOT NULL AND s.country_code <> ${HOME_COUNTRY_CODE})`;

function whereClause(f: LoginAuditFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`s.attempted_at >= ${f.from}`];
  if (f.user) {
    const like = `%${escapeLike(f.user.toLowerCase())}%`;
    parts.push(
      Prisma.sql`(s.identifier LIKE ${like} ESCAPE '\\' OR LOWER(ISNULL(s.user_name, N'')) LIKE ${like} ESCAPE '\\')`
    );
  }
  if (f.country === COUNTRY_FILTER_INTERNAL) parts.push(Prisma.sql`s.ip_scope = N'INTERNA'`);
  else if (f.country === COUNTRY_FILTER_UNKNOWN)
    parts.push(Prisma.sql`(s.ip_scope <> N'INTERNA' AND s.country_code IS NULL)`);
  else if (f.country) parts.push(Prisma.sql`s.country_code = ${f.country}`);
  if (f.result === 'ok') parts.push(Prisma.sql`s.success = 1`);
  if (f.result === 'fallo') parts.push(Prisma.sql`s.success = 0`);
  if (f.provider) parts.push(Prisma.sql`s.provider = ${f.provider}`);
  if (f.alertsOnly) parts.push(Prisma.sql`(${OUTSIDE_SQL} OR s.fail_streak >= ${FAIL_STREAK_ALERT})`);
  return Prisma.join(parts, ' AND ');
}

const toNumber = (v: number | bigint | null | undefined) => Number(v ?? 0);

export async function queryLoginAudit(
  filters: LoginAuditFilters,
  opts: { limit?: number; offset?: number } = {}
): Promise<LoginAuditPage> {
  const limit = opts.limit ?? filters.limit;
  const offset = opts.offset ?? (filters.page - 1) * filters.limit;
  const windowFrom = new Date(filters.from.getTime() - DAY_MS);

  const raw = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    WITH base AS (
      SELECT a.*,
        SUM(CASE WHEN a.success = 1 THEN 1 ELSE 0 END)
          OVER (PARTITION BY a.identifier ORDER BY a.attempted_at, a.id ROWS UNBOUNDED PRECEDING) AS grp
      FROM [dbo].[user_login_audit] a
      WHERE a.attempted_at >= ${windowFrom} AND a.attempted_at < ${filters.to}
    ),
    streaks AS (
      SELECT b.*,
        CASE WHEN b.success = 0 AND b.identifier IS NOT NULL
          THEN ROW_NUMBER() OVER (PARTITION BY b.identifier, b.grp, b.success ORDER BY b.attempted_at, b.id)
          ELSE 0 END AS fail_streak
      FROM base b
    ),
    filtered AS (
      SELECT s.*, CASE WHEN ${OUTSIDE_SQL} THEN 1 ELSE 0 END AS outside_home
      FROM streaks s
      WHERE ${whereClause(filters)}
    )
    SELECT f.id, f.attempted_at, f.provider, f.identifier, f.id_user, f.user_name, f.success,
      f.failure_reason, f.client_ip, f.ip_scope, f.country_code, f.country_name, f.region, f.city,
      f.user_agent, f.browser, f.os, f.device, f.companies, f.fail_streak, f.outside_home,
      COUNT(*) OVER () AS total_count,
      SUM(CASE WHEN f.success = 0 THEN 1 ELSE 0 END) OVER () AS failed_count,
      SUM(f.outside_home) OVER () AS outside_count,
      SUM(CASE WHEN f.fail_streak >= ${FAIL_STREAK_ALERT} THEN 1 ELSE 0 END) OVER () AS streak_count
    FROM filtered f
    ORDER BY f.attempted_at DESC, f.id DESC
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `);

  let summary: LoginAuditSummary = { total: 0, failed: 0, outsideHome: 0, streakAlerts: 0 };
  if (raw[0]) {
    summary = {
      total: toNumber(raw[0].total_count),
      failed: toNumber(raw[0].failed_count),
      outsideHome: toNumber(raw[0].outside_count),
      streakAlerts: toNumber(raw[0].streak_count),
    };
  } else if (offset > 0) {
    // Página fuera de rango: se piden solo los totales para que la paginación se corrija.
    const again = await queryLoginAudit(filters, { limit: 1, offset: 0 });
    summary = again.summary;
  }

  const rows: LoginAuditRow[] = raw.map((r) => ({
    id: Number(r.id),
    attemptedAt: new Date(r.attempted_at).toISOString(),
    provider: r.provider,
    identifier: r.identifier,
    userId: r.id_user,
    userName: r.user_name,
    success: Boolean(r.success),
    failureReason: r.failure_reason,
    clientIp: r.client_ip,
    ipScope: r.ip_scope,
    countryCode: r.country_code,
    countryName: r.country_name,
    region: r.region,
    city: r.city,
    userAgent: r.user_agent,
    browser: r.browser,
    os: r.os,
    device: r.device,
    companies: r.companies,
    failStreak: toNumber(r.fail_streak),
    outsideHome: Boolean(Number(r.outside_home)),
  }));

  return {
    rows,
    summary,
    pagination: {
      page: filters.page,
      limit,
      total: summary.total,
      pages: Math.max(1, Math.ceil(summary.total / Math.max(1, limit))),
    },
  };
}

/** Países vistos en el rango (para el filtro), más los valores especiales. */
export async function listLoginAuditCountries(
  filters: Pick<LoginAuditFilters, 'from' | 'to'>
): Promise<Array<{ code: string; name: string; count: number }>> {
  const rows = await prisma.$queryRaw<Array<{ code: string; name: string | null; n: number | bigint }>>`
    SELECT x.code, MAX(x.name) AS name, COUNT(*) AS n
    FROM (
      SELECT
        CASE WHEN ip_scope = N'INTERNA' THEN ${COUNTRY_FILTER_INTERNAL}
             WHEN country_code IS NULL THEN ${COUNTRY_FILTER_UNKNOWN}
             ELSE country_code END AS code,
        country_name AS name
      FROM [dbo].[user_login_audit]
      WHERE attempted_at >= ${filters.from} AND attempted_at < ${filters.to}
    ) x
    GROUP BY x.code
    ORDER BY COUNT(*) DESC
  `;
  return rows.map((r) => ({
    code: r.code,
    name:
      r.code === COUNTRY_FILTER_INTERNAL
        ? 'Red interna'
        : r.code === COUNTRY_FILTER_UNKNOWN
          ? 'Sin ubicación'
          : (r.name ?? r.code),
    count: toNumber(r.n),
  }));
}
