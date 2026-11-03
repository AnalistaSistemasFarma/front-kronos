import { describe, expect, it, vi } from 'vitest';
vi.mock('../../dbconfig.js', () => ({ default: {} }));
vi.mock('../purchases/authorization', () => ({ companySap: vi.fn() }));
vi.mock('../requests-general/createGeneralRequest', () => ({ createGeneralRequest: vi.fn() }));
vi.mock('../workflow-sap/engine', () => ({ runSapExecutors: vi.fn() }));
vi.mock('./flow', () => ({ simulateDraft: vi.fn() }));
import { candidatesFilter, cronFor, summaryText, validateConfig } from './automation';

describe('automatización · reglas puras', () => {
  it('filtro de candidatos: borradores de pedido abiertos en B del usuario de la integración', () => {
    expect(candidatesFilter(30, '2026-11-01')).toBe(
      "DocObjectCode eq 'oOrders' and U_SEND_State eq 'B' and DocumentStatus eq 'bost_Open' and UserSign eq 30 and DocDate ge '2026-11-01'"
    );
    expect(candidatesFilter(30, null)).not.toContain('DocDate');
    expect(candidatesFilter(30, "2026-11-01' or 1 eq 1")).not.toContain('or 1');
  });
  it('cron del programador', () => {
    expect(cronFor(10)).toBe('*/10 * * * *');
    expect(cronFor(120)).toBe('0 */2 * * *');
  });
  it('valida la configuración; para activarla exige usuario SAP y solicitante', () => {
    const base = { activo: false, simulacion: true, intervalo_min: 10, user_sign: null, desde_fecha: null, id_user_solicitante: null };
    expect(validateConfig(base)).toEqual([]);
    expect(validateConfig({ ...base, activo: true })).toHaveLength(2);
    expect(validateConfig({ ...base, intervalo_min: 2 })).toHaveLength(1);
    expect(validateConfig({ ...base, desde_fecha: '01/11/2026' })).toHaveLength(1);
  });
  it('resumen de la corrida', () => {
    expect(summaryText({ simulacion: true, candidatos: 3, enviados: 0, simulados: 3, errores: 0 })).toBe('Simulación · 3 borrador(es) nuevos: 3 simulado(s).');
    expect(summaryText({ simulacion: false, candidatos: 2, enviados: 1, simulados: 0, errores: 1 })).toBe('2 borrador(es) nuevos: 1 pasado(s) al flujo, 1 con error.');
    expect(summaryText({ omitido: 'La automatización está pausada.', simulacion: true, candidatos: 0, enviados: 0, simulados: 0, errores: 0 })).toBe('Sin procesar: La automatización está pausada.');
  });
});
