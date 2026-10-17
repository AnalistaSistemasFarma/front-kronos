/**
 * Geolocalización LOCAL: sin archivo no pasa nada; las IP internas no se consultan.
 * Si existe LOGIN_GEOIP_TEST_DB (ruta a una base DB-IP real), se prueba también la lectura.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  delete (globalThis as { __kronosLoginGeo?: unknown }).__kronosLoginGeo;
  delete process.env.LOGIN_GEOIP_DB_PATH;
  vi.resetModules();
  vi.restoreAllMocks();
});

async function load() {
  return import('../geo');
}

describe('geolocateIp', () => {
  it('sin base: IP pública queda sin país y avisa una sola vez', async () => {
    process.env.LOGIN_GEOIP_DB_PATH = '/ruta/que/no/existe.mmdb';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { geolocateIp } = await load();
    expect(geolocateIp('8.8.8.8')).toEqual({ scope: 'PUBLICA', countryCode: null, countryName: null, region: null, city: null });
    geolocateIp('1.1.1.1');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('IP interna: «Red interna» sin abrir la base', async () => {
    process.env.LOGIN_GEOIP_DB_PATH = '/ruta/que/no/existe.mmdb';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { geolocateIp } = await load();
    expect(geolocateIp('192.168.10.20').scope).toBe('INTERNA');
    expect(geolocateIp(null).scope).toBe('DESCONOCIDA');
    expect(warn).not.toHaveBeenCalled();
  });

  it.skipIf(!process.env.LOGIN_GEOIP_TEST_DB)('con base real: resuelve país (y ciudad si la base la trae)', async () => {
    process.env.LOGIN_GEOIP_DB_PATH = process.env.LOGIN_GEOIP_TEST_DB;
    const { geolocateIp } = await load();
    const google = geolocateIp('8.8.8.8');
    expect(google.scope).toBe('PUBLICA');
    expect(google.countryCode).toBe('US');
    expect(google.countryName).toBeTruthy();
  });
});
