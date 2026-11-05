import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as string[], rate: 3221.19 as number | 'missing', system: 'USD', local: 'COP' }));

vi.mock('../sap/serviceLayer', async () => {
  const actual = await vi.importActual<typeof import('../sap/serviceLayer')>('../sap/serviceLayer');
  return {
    ...actual,
    sapPost: async (_s: unknown, path: string) => {
      h.calls.push(path);
      if (path === 'SBOBobService_GetSystemCurrency') return h.system;
      if (path === 'SBOBobService_GetLocalCurrency') return h.local;
      if (h.rate === 'missing') {
        // Respuesta real de SAP (pruebas OLP, 2026-11-05) para una fecha sin tasa.
        throw new actual.SapError('Update the exchange rate', 400, '{"error":{"code":-4006,"message":{"lang":"en-us","value":"Update the exchange rate"}}}');
      }
      return h.rate;
    },
  };
});

import { SapError } from '../sap/serviceLayer';
import { __resetTrmCache, fechaDMY, isMissingRateError, trmBlock, trmMissingMessage } from './trm';

const sap = { baseUrl: 'x', sessionId: 's' } as never;

beforeEach(() => {
  __resetTrmCache();
  h.calls = [];
  h.rate = 3221.19;
  h.system = 'USD';
  h.local = 'COP';
});

describe('TRM del día (RN 2026-11-05)', () => {
  it('mensaje con la fecha en DD/MM/AAAA', () => {
    expect(fechaDMY('2026-11-05')).toBe('05/11/2026');
    expect(trmMissingMessage('2026-11-05')).toBe('No hay TRM cargada en SAP para hoy (05/11/2026). Cárguela antes de autorizar.');
  });
  it('con tasa cargada no bloquea y consulta la moneda del sistema en la fecha', async () => {
    expect(await trmBlock(sap, 3, '2026-11-05')).toBeNull();
    expect(h.calls).toContain('SBOBobService_GetCurrencyRate');
  });
  it('SAP responde −4006: bloquea con el mensaje', async () => {
    h.rate = 'missing';
    expect(await trmBlock(sap, 3, '2026-11-06')).toBe(trmMissingMessage('2026-11-06'));
  });
  it('tasa 0: bloquea', async () => {
    h.rate = 0;
    expect(await trmBlock(sap, 3, '2026-11-06')).toBe(trmMissingMessage('2026-11-06'));
  });
  it('la tasa encontrada queda en caché por empresa y fecha; la que falta no', async () => {
    await trmBlock(sap, 3, '2026-11-05');
    const n = h.calls.length;
    await trmBlock(sap, 3, '2026-11-05');
    expect(h.calls.length).toBe(n);
    h.rate = 'missing';
    await trmBlock(sap, 5, '2026-11-05'); // otra empresa: consulta de nuevo
    h.rate = 3000;
    expect(await trmBlock(sap, 5, '2026-11-05')).toBeNull(); // la cargaron: se levanta el bloqueo
  });
  it('si la moneda del sistema es la local no aplica', async () => {
    h.system = 'COP';
    h.rate = 'missing';
    expect(await trmBlock(sap, 9, '2026-11-05')).toBeNull();
  });
  it('otros errores de SAP no se confunden con falta de TRM', () => {
    expect(isMissingRateError(new SapError('x', 400, '{"error":{"code":-2039,"message":{"value":"Another user"}}}'))).toBe(false);
    expect(isMissingRateError(new Error('Update the exchange rate'))).toBe(false);
  });
});
