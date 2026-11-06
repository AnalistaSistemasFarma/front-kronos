import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Se simula el Service Layer a nivel HTTPS con las respuestas REALES de pruebas OLP
 * (z_PRUEBAS_OLP_02102026, 2026-11-05), para ejercitar sapPost/sapPostText de verdad:
 *  - SBOBobService_GetSystemCurrency / GetLocalCurrency → text/plain «USD» / «COP»
 *  - SBOBobService_GetCurrencyRate                      → text/plain «3221.190000»
 *  - fecha sin tasa                                     → 400 JSON con code −4006
 *  - CompanyService_GetAdminInfo (POST)                 → JSON con LocalCurrency/SystemCurrency
 * Regresión: PR #883 leía las monedas con sapPost (JSON.parse) y fallaba con
 * «Unexpected token 'C', "COP" is not valid JSON» (sales_authorization 31, borrador 903).
 */

const h = vi.hoisted(() => ({ calls: [] as string[], rate: '3221.190000' as string | 'missing', system: 'USD', local: 'COP' }));

function reply(status: number, contentType: string, body: string) {
  return { status, contentType, body };
}

function slResponse(path: string, sent: string) {
  const action = path.replace(/^.*\/b1s\/v1\//, '');
  h.calls.push(action);
  if (action === 'SBOBobService_GetSystemCurrency') return reply(200, 'text/plain', h.system);
  if (action === 'SBOBobService_GetLocalCurrency') return reply(200, 'text/plain', h.local);
  if (action === 'CompanyService_GetAdminInfo') {
    return reply(200, 'application/json;odata=minimalmetadata;charset=utf-8', JSON.stringify({ 'odata.metadata': 'x#SAPB1.AdminInfo', Code: 1, LocalCurrency: h.local, SystemCurrency: h.system, MultiCurrencyCheck: 'cc_Block' }));
  }
  if (action === 'SBOBobService_GetCurrencyRate') {
    expect(JSON.parse(sent)).toMatchObject({ Currency: h.system });
    if (h.rate === 'missing') {
      return reply(400, 'application/json;charset=utf-8', '{\n   "error" : {\n      "code" : -4006,\n      "message" : {\n         "lang" : "en-us",\n         "value" : "Update the exchange rate"\n      }\n   }\n}\n');
    }
    return reply(200, 'text/plain', h.rate);
  }
  return reply(404, 'application/json', '{"error":{"code":-1,"message":{"value":"no simulado"}}}');
}

vi.mock('https', () => {
  class Agent {}
  const request = (opts: { path: string }, cb: (res: EventEmitter & { statusCode: number; headers: Record<string, string> }) => void) => {
    let sent = '';
    const req = new EventEmitter() as EventEmitter & { write: (b: string) => void; end: () => void };
    req.write = (b: string) => {
      sent += String(b);
    };
    req.end = () => {
      const r = slResponse(opts.path, sent);
      const res = Object.assign(new EventEmitter(), { statusCode: r.status, headers: { 'content-type': r.contentType } });
      cb(res);
      setImmediate(() => {
        res.emit('data', Buffer.from(r.body, 'utf8'));
        res.emit('end');
      });
    };
    return req;
  };
  return { Agent, request, default: { Agent, request } };
});

import { sapPostText, SapError } from '../sap/serviceLayer';
import { __resetTrmCache, fechaDMY, isMissingRateError, parseRate, trmBlock, trmMissingMessage } from './trm';

const sap = { baseUrl: 'https://sl.test:50000', sessionId: 's' } as never;

beforeEach(() => {
  __resetTrmCache();
  h.calls = [];
  h.rate = '3221.190000';
  h.system = 'USD';
  h.local = 'COP';
});

describe('TRM del día (RN 2026-11-05)', () => {
  it('mensaje con la fecha en DD/MM/AAAA', () => {
    expect(fechaDMY('2026-11-05')).toBe('05/11/2026');
    expect(trmMissingMessage('2026-11-05')).toBe('No hay TRM cargada en SAP para hoy (05/11/2026). Cárguela antes de autorizar.');
  });
  it('SAP responde las monedas en texto plano: sapPostText las lee tal cual', async () => {
    expect(await sapPostText(sap, 'SBOBobService_GetSystemCurrency', {})).toBe('USD');
    expect(await sapPostText(sap, 'SBOBobService_GetLocalCurrency', {})).toBe('COP');
  });
  it('con tasa cargada (texto plano «3221.190000») no bloquea; monedas desde GetAdminInfo', async () => {
    expect(await trmBlock(sap, 3, '2026-11-05')).toBeNull();
    expect(h.calls).toEqual(['CompanyService_GetAdminInfo', 'SBOBobService_GetCurrencyRate']);
  });
  it('SAP responde −4006: bloquea con el mensaje', async () => {
    h.rate = 'missing';
    expect(await trmBlock(sap, 3, '2026-11-06')).toBe(trmMissingMessage('2026-11-06'));
  });
  it('tasa 0 o cuerpo no numérico: bloquea', async () => {
    h.rate = '0.000000';
    expect(await trmBlock(sap, 3, '2026-11-06')).toBe(trmMissingMessage('2026-11-06'));
    h.rate = 'COP';
    expect(await trmBlock(sap, 4, '2026-11-06')).toBe(trmMissingMessage('2026-11-06'));
  });
  it('parseRate: texto plano, comillas, número; lo demás es NaN', () => {
    expect(parseRate('3221.190000')).toBe(3221.19);
    expect(parseRate(' "3235.59"\n')).toBe(3235.59);
    expect(parseRate(3312.84)).toBe(3312.84);
    expect(parseRate('COP')).toBeNaN();
    expect(parseRate('')).toBeNaN();
  });
  it('la tasa encontrada queda en caché por empresa y fecha; la que falta no', async () => {
    await trmBlock(sap, 3, '2026-11-05');
    const n = h.calls.length;
    await trmBlock(sap, 3, '2026-11-05');
    expect(h.calls.length).toBe(n);
    h.rate = 'missing';
    await trmBlock(sap, 5, '2026-11-05'); // otra empresa: consulta de nuevo
    h.rate = '3000.000000';
    expect(await trmBlock(sap, 5, '2026-11-05')).toBeNull(); // la cargaron: se levanta el bloqueo
  });
  it('si la moneda del sistema es la local no aplica', async () => {
    h.system = 'COP';
    h.rate = 'missing';
    expect(await trmBlock(sap, 9, '2026-11-05')).toBeNull();
    expect(h.calls).not.toContain('SBOBobService_GetCurrencyRate');
  });
  it('otros errores de SAP no se confunden con falta de TRM', () => {
    expect(isMissingRateError(new SapError('x', 400, '{"error":{"code":-2039,"message":{"value":"Another user"}}}'))).toBe(false);
    expect(isMissingRateError(new Error('Update the exchange rate'))).toBe(false);
  });
});
