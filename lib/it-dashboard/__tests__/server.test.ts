import { describe, expect, it } from 'vitest';
import { buildPerformance, isServerType, metricsHostKey, validateNetworkInput } from '../server';

describe('isServerType', () => {
  it('detects the SERVIDOR type only', () => {
    expect(isServerType('SERVIDOR')).toBe(true);
    expect(isServerType('Servidores')).toBe(true);
    expect(isServerType('COMPUTADORES')).toBe(false);
    expect(isServerType(null)).toBe(false);
  });
});

describe('validateNetworkInput', () => {
  it('accepts empty and valid values (trimmed)', () => {
    const empty = validateNetworkInput({});
    expect(empty.ok).toBe(true);

    const r = validateNetworkInput({
      hostname: ' PCE0023 ',
      ipAddress: '192.168.10.23',
      subnetMask: '/24',
      gateway: '192.168.10.1',
      dnsServers: '8.8.8.8, 1.1.1.1',
      vlan: '10',
      macAddress: 'aa:bb:cc:dd:ee:ff',
      notes: 'RDP 3389',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.hostname).toBe('PCE0023');
  });

  it('rejects bad IP, mask, DNS, MAC, hostname and too long text', () => {
    const r = validateNetworkInput({
      hostname: 'bad host!',
      ipAddress: '300.1.1.1',
      subnetMask: '255.255',
      dnsServers: '8.8.8.8, nope',
      macAddress: 'AABBCC',
      notes: 'x'.repeat(1001),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(
        ['dnsServers', 'hostname', 'ipAddress', 'macAddress', 'notes', 'subnetMask'].sort()
      );
    }
  });
});

describe('performance', () => {
  it('uses the first label of the hostname, upper case', () => {
    expect(metricsHostKey('pce0023.gss.local')).toBe('PCE0023');
    expect(metricsHostKey('  ')).toBeNull();
  });

  it('live within 10 minutes, stale after, none without data', () => {
    const now = new Date('2026-11-26T22:00:00Z');
    const last = { sampledAt: '2026-11-26T21:55:00Z', cpu: 12.345, mem: '61.2', memTotalMb: 16384 };
    const day = { cpuAvg: 10, cpuMax: 80.06, memAvg: 60, memMax: 70 };

    const live = buildPerformance('PCE0023', last, day, now);
    expect(live.state).toBe('live');
    expect(live.cpuPct).toBe(12.3);
    expect(live.memPct).toBe(61.2);
    expect(live.cpuMax24h).toBe(80.1);

    expect(buildPerformance('PCE0023', { ...last, sampledAt: '2026-11-26T20:00:00Z' }, day, now).state).toBe('stale');
    expect(buildPerformance('PCE0023', null, null, now).state).toBe('none');
    expect(buildPerformance(null, last, day, now).state).toBe('none');
  });
});
