import { afterEach, describe, expect, it } from 'vitest';
import { pulseServiceLayer, __resetSlPulseForTests } from '../slPulse';

afterEach(() => __resetSlPulseForTests());

describe('pulseServiceLayer', () => {
  it('URL inválida no lanza y marca error', async () => {
    const r = await pulseServiceLayer('http://');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('host inexistente responde sin respuesta (no lanza)', async () => {
    const r = await pulseServiceLayer('https://host-que-no-existe.invalid:50000/b1s/v1');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.latencyMs).not.toBeNull();
  });

  it('usa caché por host dentro de 10 s', async () => {
    const a = await pulseServiceLayer('https://host-que-no-existe.invalid:50000/b1s/v1');
    const b = await pulseServiceLayer('https://host-que-no-existe.invalid:50000/b1s/v1/Orders');
    expect(b).toBe(a);
  });
});
