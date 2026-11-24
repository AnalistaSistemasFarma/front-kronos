import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetSapsendCallMetricsForTests,
  beginSapsendCall,
  getSapsendLiveStats,
} from '../callMetrics.js';

describe('sapsend callMetrics', () => {
  beforeEach(() => {
    __resetSapsendCallMetricsForTests();
  });

  it('cuenta inflight y errores por operación', async () => {
    const end = beginSapsendCall('create');
    expect(getSapsendLiveStats().find((s) => s.op === 'create')?.inflight).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    end(500);
    beginSapsendCall('create')(200);

    const row = getSapsendLiveStats().find((s) => s.op === 'create');
    expect(row?.inflight).toBe(0);
    expect(row?.requests).toBe(2);
    expect(row?.errors).toBe(1);
    expect(row?.peakInflight).toBe(1);
  });
});
