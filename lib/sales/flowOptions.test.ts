import { describe, expect, it } from 'vitest';
import { OPTION_CREDIT, OPTION_PRICE, optionsForCreditRecheck, optionsForSend, rejectedStateFor, traceFieldFor } from './flowOptions';

describe('opciones del condicional', () => {
  it('al enviar: precio primero; si no, cupo; si no, nada', () => {
    expect(optionsForSend({ destino: 'AP' })).toEqual([OPTION_PRICE]);
    expect(optionsForSend({ destino: 'AE' })).toEqual([OPTION_CREDIT]);
    expect(optionsForSend({ destino: 'PEDIDO' })).toEqual([]);
  });
  it('al revaluar el cupo tras precios', () => {
    expect(optionsForCreditRecheck('AE')).toEqual([OPTION_CREDIT]);
    expect(optionsForCreditRecheck('PEDIDO')).toEqual([]);
  });
});

describe('rechazos y trazas', () => {
  it('estado de rechazo según la etapa', () => {
    expect(rejectedStateFor('AP')).toBe('NAP');
    expect(rejectedStateFor(' ae ')).toBe('NADC');
    expect(rejectedStateFor('AEDA')).toBe('NADA');
    expect(rejectedStateFor('B')).toBeNull();
    expect(rejectedStateFor(null)).toBeNull();
  });
  it('campo de traza de SAPSEND por etapa y decisión', () => {
    expect(traceFieldFor('AP', true)).toBe('U_SEND_TraAproAP');
    expect(traceFieldFor('AE', false)).toBe('U_SEND_TraDenAE');
    expect(traceFieldFor('AEDA', true)).toBe('U_SEND_TraAproAEDA');
  });
});
