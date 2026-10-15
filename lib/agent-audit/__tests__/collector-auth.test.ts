import { describe, expect, it } from 'vitest';
import { isCollectorRequest } from '../collector-auth';

const KEY = 'k'.repeat(40);
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const req = (auth?: string) =>
  new Request('http://x/api', { headers: auth ? { authorization: auth } : {} });

describe('isCollectorRequest', () => {
  it('acepta solo la llave configurada', () => {
    expect(
      isCollectorRequest(req(`Bearer ${KEY}`), env({ AGENT_INVENTORY_COLLECTOR_KEY: KEY }))
    ).toBe(true);
    expect(
      isCollectorRequest(req('Bearer otra'), env({ AGENT_INVENTORY_COLLECTOR_KEY: KEY }))
    ).toBe(false);
    expect(isCollectorRequest(req(), env({ AGENT_INVENTORY_COLLECTOR_KEY: KEY }))).toBe(false);
  });

  it('cerrado por defecto sin llave o con llave corta', () => {
    expect(isCollectorRequest(req('Bearer '), env({}))).toBe(false);
    expect(
      isCollectorRequest(req('Bearer corta'), env({ AGENT_INVENTORY_COLLECTOR_KEY: 'corta' }))
    ).toBe(false);
  });
});
