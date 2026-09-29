import { describe, expect, it, vi } from 'vitest';
import {
  POOL_CONNECT_MAX_ATTEMPTS,
  connectWithRetry,
  isRetryableConnectError,
  poolConnectRetryDelayMs,
  shouldRetryPoolConnect,
} from '../poolConnectRetry';

const withCode = (code: string) => Object.assign(new Error(code), { code });

describe('isRetryableConnectError', () => {
  it.each(['ESOCKET', 'ECONNRESET', 'ECONNCLOSED', 'ENOTOPEN', 'ETIMEOUT'])(
    'reintenta %s',
    (code) => {
      expect(isRetryableConnectError(withCode(code))).toBe(true);
    }
  );

  it('reintenta si el código viene en originalError (envoltura de mssql)', () => {
    const err = Object.assign(new Error('Connection lost'), {
      code: 'EUNKNOWN',
      originalError: { code: 'ECONNRESET' },
    });
    expect(isRetryableConnectError(err)).toBe(true);
  });

  it('no reintenta login fallido, argumentos inválidos ni errores sin código', () => {
    expect(isRetryableConnectError(withCode('ELOGIN'))).toBe(false);
    expect(isRetryableConnectError(withCode('ERR_MISSING_ARGS'))).toBe(false);
    expect(isRetryableConnectError(new Error('boom'))).toBe(false);
    expect(isRetryableConnectError(null)).toBe(false);
    expect(isRetryableConnectError('ESOCKET')).toBe(false);
  });
});

describe('shouldRetryPoolConnect', () => {
  it('reintenta errores transitorios mientras queden intentos', () => {
    expect(POOL_CONNECT_MAX_ATTEMPTS).toBe(3);
    expect(shouldRetryPoolConnect(withCode('ESOCKET'), 1)).toBe(true);
    expect(shouldRetryPoolConnect(withCode('ESOCKET'), 2)).toBe(true);
    expect(shouldRetryPoolConnect(withCode('ESOCKET'), 3)).toBe(false);
  });

  it('no reintenta errores permanentes aunque queden intentos', () => {
    expect(shouldRetryPoolConnect(withCode('ELOGIN'), 1)).toBe(false);
  });
});

describe('poolConnectRetryDelayMs', () => {
  it('espera ≈200 ms y luego ≈800 ms, con azar acotado', () => {
    expect(poolConnectRetryDelayMs(1, () => 0)).toBe(200);
    expect(poolConnectRetryDelayMs(2, () => 0)).toBe(800);
    expect(poolConnectRetryDelayMs(1, () => 0.999)).toBeLessThanOrEqual(250);
    expect(poolConnectRetryDelayMs(2, () => 0.999)).toBeLessThanOrEqual(1000);
    expect(poolConnectRetryDelayMs(9, () => 0)).toBe(800);
  });
});

describe('connectWithRetry', () => {
  const noSleep = (_ms: number) => Promise.resolve();

  it('reconecta tras fallos transitorios y devuelve el pool', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(withCode('ESOCKET'))
      .mockRejectedValueOnce(withCode('ETIMEOUT'))
      .mockResolvedValue('pool');
    const sleep = vi.fn(noSleep);
    await expect(connectWithRetry(connect, { sleep, random: () => 0 })).resolves.toBe('pool');
    expect(connect).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([200, 800]);
  });

  it('se rinde al tercer intento', async () => {
    const connect = vi.fn().mockRejectedValue(withCode('ECONNRESET'));
    await expect(connectWithRetry(connect, { sleep: noSleep })).rejects.toMatchObject({
      code: 'ECONNRESET',
    });
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('no reintenta un error permanente', async () => {
    const connect = vi.fn().mockRejectedValue(withCode('ELOGIN'));
    await expect(connectWithRetry(connect, { sleep: noSleep })).rejects.toMatchObject({
      code: 'ELOGIN',
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
