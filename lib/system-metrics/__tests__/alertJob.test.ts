import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchSample } from '../earlyWarnings';

const NOW = new Date('2026-10-07T14:30:20Z');
const minuteIso = (minsAgo: number) => new Date(Math.floor(NOW.getTime() / 60_000) * 60_000 - minsAgo * 60_000).toISOString();

const calls: string[] = [];
const readWatchWindow = vi.fn();
const readRecentAlerts = vi.fn();
const insertAlert = vi.fn(async (_pool: unknown, _at: Date, _host: string, w: { key: string }, _notified: number) => {
  calls.push(`insert:${w.key}`);
});

vi.mock('../store', () => ({ readWatchWindow, readRecentAlerts, insertAlert }));

const { runEarlyWarnings, ALERTS_URL } = await import('../alertJob');

/** Dos procesos normales la última hora, con la memoria del servidor al 93 %. */
function memoryFull(): WatchSample[] {
  const out: WatchSample[] = [];
  for (const [pid, instance] of [
    [100, '0'],
    [101, '1'],
  ] as const) {
    for (let m = 60; m >= 0; m -= 1) {
      out.push({
        sampledAt: minuteIso(m),
        host: 'SERFARMA05',
        instance,
        pid,
        hostCpuPct: 20,
        hostMemUsedPct: 93,
        hostMemTotalMb: 20480,
        rssMb: 500,
        eventLoopP99Ms: 20,
        eventLoopMaxMs: 40,
        httpRequests: 30,
        httpErrors: 0,
        poolPending: 0,
      });
    }
  }
  return out;
}

describe('runEarlyWarnings', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
    readWatchWindow.mockResolvedValue({ samples: memoryFull(), db: [] });
  });

  const deps = (notify = vi.fn(async (_emails: string[], payload: { title: string }) => {
    calls.push(`notify:${payload.title}`);
  })) => ({
    recipients: vi.fn(async () => ['ana@gss.com', 'beto@gss.com']),
    notify,
  });

  it('guarda la alerta y luego avisa a quienes tienen el módulo', async () => {
    readRecentAlerts.mockResolvedValue([]);
    const d = deps();
    const { notified } = await runEarlyWarnings({} as never, 'SERFARMA05', d, NOW);

    expect(notified.map((w) => w.key)).toEqual(['memoria']);
    expect(calls).toEqual(['insert:memoria', 'notify:Alerta crítica: La memoria del servidor está al 93 % · SynerLink']);
    expect(insertAlert.mock.calls[0][4]).toBe(2);
    expect(d.notify).toHaveBeenCalledWith(
      ['ana@gss.com', 'beto@gss.com'],
      expect.objectContaining({ url: ALERTS_URL, tag: 'system-alert-memoria' })
    );
  });

  it('no repite una alerta que ya se envió hace poco', async () => {
    readRecentAlerts.mockResolvedValue([
      { key: 'memoria', severity: 'critical', raisedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() },
    ]);
    const d = deps();
    const { active, notified } = await runEarlyWarnings({} as never, 'SERFARMA05', d, NOW);

    expect(active).toHaveLength(1);
    expect(notified).toHaveLength(0);
    expect(insertAlert).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('si el envío falla, la alerta queda registrada y no rompe', async () => {
    readRecentAlerts.mockResolvedValue([]);
    const d = deps(vi.fn(async () => {
      throw new Error('push caído');
    }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runEarlyWarnings({} as never, 'SERFARMA05', d, NOW)).resolves.toMatchObject({ notified: [{ key: 'memoria' }] });
    expect(insertAlert).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('sin problemas no consulta el historial ni avisa', async () => {
    readWatchWindow.mockResolvedValue({ samples: [], db: [] });
    const d = deps();
    await runEarlyWarnings({} as never, 'SERFARMA05', d, NOW);
    expect(readRecentAlerts).not.toHaveBeenCalled();
    expect(d.recipients).not.toHaveBeenCalled();
  });
});
