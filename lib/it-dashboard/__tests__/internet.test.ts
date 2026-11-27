import { describe, expect, it } from 'vitest';
import { channelLabel, connectionLabel, validateInternetInput } from '../internet';

describe('validateInternetInput', () => {
  it('accepts empty and a full valid record (trimmed)', () => {
    expect(validateInternetInput({}).ok).toBe(true);
    const r = validateInternetInput({
      provider: ' Claro ',
      publicIp: '190.85.10.20',
      subnetMask: '255.255.255.248',
      gateway: '190.85.10.17',
      dnsServers: '8.8.8.8; 1.1.1.1',
      bandwidth: '300 Mbps',
      channelType: 'dedicado',
      connectionType: 'fibra',
      notes: 'Contrato 123',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.provider).toBe('Claro');
  });

  it('rejects bad IPs, mask, DNS and unknown channel / connection', () => {
    const r = validateInternetInput({
      publicIp: '1.2.3',
      subnetMask: 'abc',
      gateway: '999.0.0.1',
      dnsServers: '8.8.8.8, x',
      channelType: 'satelital',
      connectionType: 'cobre',
      bandwidth: 'x'.repeat(51),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(
        ['bandwidth', 'channelType', 'connectionType', 'dnsServers', 'gateway', 'publicIp', 'subnetMask'].sort()
      );
    }
  });

  it('labels', () => {
    expect(channelLabel('banda_ancha')).toBe('Banda ancha');
    expect(connectionLabel('coaxial')).toBe('Coaxial');
    expect(channelLabel('')).toBe('');
  });
});
