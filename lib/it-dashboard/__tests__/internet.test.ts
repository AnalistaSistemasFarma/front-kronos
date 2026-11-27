import { describe, expect, it } from 'vitest';
import { channelLabel, connectionLabel, internetButtonLabel, validateInternetInput } from '../internet';

describe('validateInternetInput', () => {
  it('needs the provider or a name; accepts a full record (trimmed)', () => {
    expect(validateInternetInput({}).ok).toBe(false);
    expect(validateInternetInput({ label: 'Canal respaldo' }).ok).toBe(true);
    const r = validateInternetInput({
      provider: ' Claro ',
      publicIp: '190.85.10.20',
      subnetMask: '255.255.255.248',
      gateway: '190.85.10.17',
      dnsServers: '8.8.8.8',
      dns2: '1.1.1.1',
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
      provider: 'ETB',
      publicIp: '1.2.3',
      subnetMask: 'abc',
      gateway: '999.0.0.1',
      dnsServers: '8.8.8.8, 1.1.1.1',
      dns2: 'x',
      channelType: 'satelital',
      connectionType: 'cobre',
      bandwidth: 'x'.repeat(51),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(
        ['bandwidth', 'channelType', 'connectionType', 'dns2', 'dnsServers', 'gateway', 'publicIp', 'subnetMask'].sort()
      );
    }
  });

  it('labels and button text', () => {
    expect(channelLabel('banda_ancha')).toBe('Banda ancha');
    expect(connectionLabel('coaxial')).toBe('Coaxial');
    expect(internetButtonLabel({ label: '', provider: 'ETB', bandwidth: '100 Mbps' }, 0)).toBe('ETB · 100 Mbps');
    expect(internetButtonLabel({ label: 'Respaldo', provider: 'Claro', bandwidth: '50 Mbps' }, 1)).toBe('Respaldo');
    expect(internetButtonLabel({ label: '', provider: '', bandwidth: '' }, 2)).toBe('Canal 3');
  });
});
