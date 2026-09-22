import { describe, it, expect, vi } from 'vitest';
import {
  getMonthlySummary,
  getServiceLayerMetrics,
  upsertDailyMetric,
  toDateOnlyString,
  SERVICE_LAYER_METRICS_DEFAULT_COMPANY,
} from '../metrics';

describe('getMonthlySummary (PURA, sin BD)', () => {
  it('agrupa por mes, suma transacciones y calcula promedio diario redondeado', () => {
    const result = getMonthlySummary([
      { date: '2026-05-23', transactionCount: 764 },
      { date: '2026-05-24', transactionCount: 1779 },
      { date: '2026-05-25', transactionCount: 17230 },
      { date: '2026-06-01', transactionCount: 10000 },
    ]);

    expect(result).toEqual([
      { month: '2026-05', totalTransactions: 19773, daysWithData: 3, averagePerDay: 6591 },
      { month: '2026-06', totalTransactions: 10000, daysWithData: 1, averagePerDay: 10000 },
    ]);
  });

  it('ordena los meses ascendente aunque las filas lleguen desordenadas', () => {
    const result = getMonthlySummary([
      { date: '2026-08-01', transactionCount: 100 },
      { date: '2026-05-23', transactionCount: 50 },
      { date: '2026-07-01', transactionCount: 200 },
    ]);
    expect(result.map((r) => r.month)).toEqual(['2026-05', '2026-07', '2026-08']);
  });

  it('ignora filas con fecha inválida o conteo no numérico, sin reventar', () => {
    const result = getMonthlySummary([
      { date: '2026-05-23', transactionCount: 100 },
      { date: 'fecha-invalida', transactionCount: 999 },
      { date: '2026-05-24', transactionCount: NaN },
    ]);
    expect(result).toEqual([
      { month: '2026-05', totalTransactions: 100, daysWithData: 1, averagePerDay: 100 },
    ]);
  });

  it('devuelve arreglo vacío si no hay filas', () => {
    expect(getMonthlySummary([])).toEqual([]);
  });
});

describe('toDateOnlyString', () => {
  it('convierte un Date a YYYY-MM-DD sin desfase de zona horaria', () => {
    expect(toDateOnlyString(new Date('2026-08-13T00:00:00.000Z'))).toBe('2026-08-13');
  });
});

describe('getServiceLayerMetrics (consulta con Prisma mockeado)', () => {
  it('camino feliz: usa la empresa por defecto (OLP) y mapea metric_date/transaction_count', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { metric_date: new Date('2026-08-13T00:00:00.000Z'), transaction_count: 13843 },
      { metric_date: new Date('2026-08-14T00:00:00.000Z'), transaction_count: 5000 },
    ]);
    const prismaMock = { serviceLayerDailyMetric: { findMany } } as never;

    const result = await getServiceLayerMetrics(prismaMock);

    expect(findMany).toHaveBeenCalledWith({
      where: { company: SERVICE_LAYER_METRICS_DEFAULT_COMPANY },
      orderBy: { metric_date: 'asc' },
    });
    expect(result).toEqual([
      { date: '2026-08-13', transactionCount: 13843 },
      { date: '2026-08-14', transactionCount: 5000 },
    ]);
  });

  it('filtro de fechas: arma el where con gte/lte a partir de from/to', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prismaMock = { serviceLayerDailyMetric: { findMany } } as never;

    await getServiceLayerMetrics(prismaMock, { from: '2026-07-01', to: '2026-07-31' });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        company: SERVICE_LAYER_METRICS_DEFAULT_COMPANY,
        metric_date: {
          gte: new Date('2026-07-01T00:00:00.000Z'),
          lte: new Date('2026-07-31T00:00:00.000Z'),
        },
      },
      orderBy: { metric_date: 'asc' },
    });
  });

  it('filtro de fechas parcial: solo "from" arma únicamente gte', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prismaMock = { serviceLayerDailyMetric: { findMany } } as never;

    await getServiceLayerMetrics(prismaMock, { from: '2026-07-01' });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        company: SERVICE_LAYER_METRICS_DEFAULT_COMPANY,
        metric_date: { gte: new Date('2026-07-01T00:00:00.000Z') },
      },
      orderBy: { metric_date: 'asc' },
    });
  });

  it('permite pasar una empresa distinta a la de por defecto', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prismaMock = { serviceLayerDailyMetric: { findMany } } as never;

    await getServiceLayerMetrics(prismaMock, { company: 'FARMALOGICA' });

    expect(findMany).toHaveBeenCalledWith({
      where: { company: 'FARMALOGICA' },
      orderBy: { metric_date: 'asc' },
    });
  });
});

describe('upsertDailyMetric', () => {
  it('hace upsert con el where compuesto (company, metric_date) y create/update simétricos', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prismaMock = { serviceLayerDailyMetric: { upsert } } as never;

    await upsertDailyMetric(prismaMock, { company: 'OLP', date: '2026-08-13', transactionCount: 13843 });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        company_metric_date: { company: 'OLP', metric_date: new Date('2026-08-13T00:00:00.000Z') },
      },
      create: { company: 'OLP', metric_date: new Date('2026-08-13T00:00:00.000Z'), transaction_count: 13843 },
      update: { transaction_count: 13843 },
    });
  });
});
