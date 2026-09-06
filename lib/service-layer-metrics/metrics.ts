import type { PrismaClient } from '../../app/generated/prisma';

/**
 * Métricas diarias del SAP Business One Service Layer (OLP). Reemplaza el
 * Excel manual: cuenta líneas del log del balanceador del Service Layer
 * (puerto 50000, recibe todo el tráfico) en serfarma07 (192.168.10.7).
 *
 * Este archivo concentra la lógica PURA (agrupación mensual, sin BD) y la
 * lectura contra Prisma (consulta simple, sin lógica de negocio) para que
 * ambas se puedan testear por separado -- ver __tests__/metrics.test.ts.
 */

export const SERVICE_LAYER_METRICS_DEFAULT_COMPANY = 'OLP';

export interface ServiceLayerMetricRow {
  /** Fecha en formato YYYY-MM-DD (sin hora, sin timezone). */
  date: string;
  transactionCount: number;
}

export interface ServiceLayerMonthlySummaryRow {
  /** Mes en formato YYYY-MM. */
  month: string;
  /** Suma de transacciones del mes. */
  totalTransactions: number;
  /** Cantidad de días con dato en ese mes (para detectar meses incompletos). */
  daysWithData: number;
  /** Promedio diario del mes (totalTransactions / daysWithData). */
  averagePerDay: number;
}

/**
 * Agrupa filas diarias en un resumen mensual (mes -> total, días con dato,
 * promedio diario). Función PURA: no toca BD ni fechas del sistema, así
 * que es 100% testeable sin mocks -- ver skill de "columnas nuevas al final
 * del query" / convención de extraer resúmenes como funciones puras del
 * resto del repo (p.ej. lib/dashboard/resolutionTimeSeries.ts).
 *
 * Ordena el resultado por mes ascendente. Filas con fecha inválida se
 * ignoran (no revientan el resumen completo por un dato sucio).
 */
export function getMonthlySummary(rows: ServiceLayerMetricRow[]): ServiceLayerMonthlySummaryRow[] {
  const byMonth = new Map<string, { total: number; days: number }>();

  for (const row of rows) {
    const month = row.date?.slice(0, 7);
    if (!month || !/^\d{4}-\d{2}$/.test(month)) continue;
    if (!Number.isFinite(row.transactionCount)) continue;

    const entry = byMonth.get(month) ?? { total: 0, days: 0 };
    entry.total += row.transactionCount;
    entry.days += 1;
    byMonth.set(month, entry);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { total, days }]) => ({
      month,
      totalTransactions: total,
      daysWithData: days,
      averagePerDay: days > 0 ? Math.round(total / days) : 0,
    }));
}

export interface GetServiceLayerMetricsParams {
  company?: string;
  /** Fecha inicial inclusiva, formato YYYY-MM-DD. */
  from?: string;
  /** Fecha final inclusiva, formato YYYY-MM-DD. */
  to?: string;
}

/**
 * Lee las métricas diarias desde la tabla ServiceLayerDailyMetric, con
 * filtro opcional de rango de fechas. Recibe el cliente Prisma como
 * parámetro (en vez de importar el singleton directo) para que el endpoint
 * y las pruebas puedan pasar un mock -- mismo criterio que el resto del
 * repo (ver lib/document-management/documents.test.ts, vi.mock('../../prisma')).
 */
export async function getServiceLayerMetrics(
  prisma: Pick<PrismaClient, 'serviceLayerDailyMetric'>,
  params: GetServiceLayerMetricsParams = {}
): Promise<ServiceLayerMetricRow[]> {
  const company = params.company ?? SERVICE_LAYER_METRICS_DEFAULT_COMPANY;

  const where: Record<string, unknown> = { company };
  if (params.from || params.to) {
    const metricDate: Record<string, Date> = {};
    if (params.from) metricDate.gte = new Date(`${params.from}T00:00:00.000Z`);
    if (params.to) metricDate.lte = new Date(`${params.to}T00:00:00.000Z`);
    where.metric_date = metricDate;
  }

  const rows = await prisma.serviceLayerDailyMetric.findMany({
    where,
    orderBy: { metric_date: 'asc' },
  });

  return rows.map((row) => ({
    date: toDateOnlyString(row.metric_date),
    transactionCount: row.transaction_count,
  }));
}

/** Convierte un Date (que Prisma devuelve para @db.Date) a "YYYY-MM-DD" sin desfase de timezone. */
export function toDateOnlyString(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}

export interface UpsertDailyMetricParams {
  company: string;
  /** Fecha en formato YYYY-MM-DD. */
  date: string;
  transactionCount: number;
}

/**
 * Upsert de una fila diaria (idempotente por el único compuesto
 * (company, metric_date)). Usada por el backfill histórico
 * (prisma/seeds/run-service-layer-metrics-backfill.mjs) Y por el job diario
 * (lib/service-layer-metrics/collectDailyMetric.ts) -- una sola función,
 * sin duplicar la lógica de escritura entre los dos.
 */
export async function upsertDailyMetric(
  prisma: Pick<PrismaClient, 'serviceLayerDailyMetric'>,
  params: UpsertDailyMetricParams
): Promise<void> {
  const metricDate = new Date(`${params.date}T00:00:00.000Z`);
  await prisma.serviceLayerDailyMetric.upsert({
    where: {
      company_metric_date: {
        company: params.company,
        metric_date: metricDate,
      },
    },
    create: {
      company: params.company,
      metric_date: metricDate,
      transaction_count: params.transactionCount,
    },
    update: {
      transaction_count: params.transactionCount,
    },
  });
}
