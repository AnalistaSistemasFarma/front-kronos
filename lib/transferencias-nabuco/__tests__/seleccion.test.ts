import { describe, expect, it } from 'vitest';
import { debeProcesar, filtroCandidatos, reintentosAgotados, seleccionarDocumentos, type EnvioPrevio } from '../seleccion';

const ahora = new Date('2026-10-25T12:00:00Z');
const base = { simulacion: false, maxReintentos: 2, ahora };

describe('selección e idempotencia', () => {
  it('nunca reprocesa enviados ni descartados', () => {
    expect(debeProcesar({ doc_entry: 1, estado: 'enviado', intentos: 1, proximo_intento: null }, base)).toBe(false);
    expect(debeProcesar({ doc_entry: 1, estado: 'descartado', intentos: 0, proximo_intento: null }, base)).toBe(false);
    expect(debeProcesar(undefined, base)).toBe(true);
  });

  it('errores: respeta la espera y el máximo de reintentos (1 intento + N)', () => {
    const futuro = new Date(ahora.getTime() + 60000);
    const pasado = new Date(ahora.getTime() - 60000);
    expect(debeProcesar({ doc_entry: 1, estado: 'error', intentos: 1, proximo_intento: futuro }, base)).toBe(false);
    expect(debeProcesar({ doc_entry: 1, estado: 'error', intentos: 2, proximo_intento: pasado }, base)).toBe(true);
    expect(debeProcesar({ doc_entry: 1, estado: 'error', intentos: 3, proximo_intento: pasado }, base)).toBe(false);
    expect(reintentosAgotados(3, 2)).toBe(true);
    expect(reintentosAgotados(2, 2)).toBe(false);
  });

  it('simulados: se envían de verdad solo al salir de simulación', () => {
    const p: EnvioPrevio = { doc_entry: 1, estado: 'simulado', intentos: 0, proximo_intento: null };
    expect(debeProcesar(p, { ...base, simulacion: true })).toBe(false);
    expect(debeProcesar(p, base)).toBe(true);
  });

  it('deduplica, ordena por DocEntry y corta en el lote', () => {
    const previos: EnvioPrevio[] = [{ doc_entry: 2, estado: 'enviado', intentos: 1, proximo_intento: null }];
    const r = seleccionarDocumentos([{ DocEntry: 5 }, { DocEntry: 2 }, { DocEntry: 3 }, { DocEntry: 3 }, { DocEntry: 1 }], previos, { ...base, loteMax: 2 });
    expect(r.map((d) => d.DocEntry)).toEqual([1, 3]);
  });

  it('arma el filtro de candidatos con fecha y filtro adicional', () => {
    expect(filtroCandidatos('2026-10-01', "DocumentStatus eq 'bost_Open'")).toBe("DocDate ge '2026-10-01' and (DocumentStatus eq 'bost_Open')");
    expect(filtroCandidatos(null, '')).toBeNull();
    expect(filtroCandidatos("2026-10-01' or 1 eq 1", null)).toBeNull();
  });
});
