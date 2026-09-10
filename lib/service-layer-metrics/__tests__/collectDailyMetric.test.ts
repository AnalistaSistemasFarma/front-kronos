import { describe, it, expect, vi } from 'vitest';
import {
  buildLogFileName,
  getYesterdayDate,
  countServiceLayerLogLines,
  collectDailyMetric,
  SERFARMA07_HOST,
  SERFARMA07_SSH_USER,
  SERFARMA07_SSH_KEY_PATH,
} from '../collectDailyMetric';

describe('buildLogFileName (PURA)', () => {
  it('arma el nombre del log del balanceador (puerto 50000) a partir de una fecha YYYY-MM-DD', () => {
    expect(buildLogFileName('2026-08-13')).toBe('access_50000_log_2026_08_13');
  });
});

describe('getYesterdayDate (PURA, con reloj inyectado)', () => {
  it('devuelve el día calendario anterior en YYYY-MM-DD', () => {
    expect(getYesterdayDate(new Date('2026-09-03T01:15:00'))).toBe('2026-09-02');
  });

  it('cruza correctamente el límite de mes', () => {
    expect(getYesterdayDate(new Date('2026-06-01T01:15:00'))).toBe('2026-05-31');
  });
});

describe('countServiceLayerLogLines (SSH mockeado -- NUNCA dispara SSH real en pruebas)', () => {
  it('camino feliz: parsea "COUNT:<n>" de la salida SSH', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'COUNT:13843\n', stderr: '' });

    const result = await countServiceLayerLogLines('2026-08-13', exec);

    expect(result).toBe(13843);
    expect(exec).toHaveBeenCalledWith('ssh', [
      '-i',
      SERFARMA07_SSH_KEY_PATH,
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=15',
      `${SERFARMA07_SSH_USER}@${SERFARMA07_HOST}`,
      expect.stringContaining('access_50000_log_2026_08_13'),
    ]);
  });

  it('devuelve null (no siembra dato falso) cuando el log todavía no existe', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'MISSING\n', stderr: '' });
    const result = await countServiceLayerLogLines('2026-09-03', exec);
    expect(result).toBeNull();
  });

  it('lanza error controlado si la salida SSH no se puede interpretar', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'algo-inesperado', stderr: '' });
    await expect(countServiceLayerLogLines('2026-08-13', exec)).rejects.toThrow(/No se pudo interpretar/);
  });
});

describe('collectDailyMetric (orquestación: SSH + Prisma mockeados)', () => {
  it('camino feliz: cuenta el log de AYER y hace upsert con esa fecha/conteo', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'COUNT:4744\n', stderr: '' });
    const upsert = vi.fn().mockResolvedValue({});
    const prismaMock = { serviceLayerDailyMetric: { upsert } } as never;

    const result = await collectDailyMetric(prismaMock, {
      now: new Date('2026-09-02T01:15:00'),
      exec,
    });

    expect(result).toEqual({ date: '2026-09-01', transactionCount: 4744, skipped: false });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ company: 'OLP', transaction_count: 4744 }),
      })
    );
  });

  it('si el log de ayer todavía no existe, no hace upsert y marca skipped', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'MISSING\n', stderr: '' });
    const upsert = vi.fn();
    const prismaMock = { serviceLayerDailyMetric: { upsert } } as never;

    const result = await collectDailyMetric(prismaMock, {
      now: new Date('2026-09-02T01:15:00'),
      exec,
    });

    expect(result).toEqual({ date: '2026-09-01', transactionCount: null, skipped: true });
    expect(upsert).not.toHaveBeenCalled();
  });
});
