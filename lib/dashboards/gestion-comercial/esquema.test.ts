import { beforeEach, describe, expect, it } from 'vitest';
import {
  esErrorEsquemaViejo,
  esquemaEnCache,
  guardarEsquema,
  limpiarCacheEsquema,
  llaveEsquema,
  normalizarLinea,
  SELECT_NUEVO,
  SELECT_VIEJO,
} from './esquema';
import { aFila } from './tablero';

describe('selects de la vista', () => {
  it('ninguno pide N° Documento; el nuevo tampoco pide Documento', () => {
    for (const c of [...SELECT_NUEVO, ...SELECT_VIEJO]) expect(c).not.toContain('°');
    expect(SELECT_NUEVO).not.toContain('Documento');
    expect(SELECT_NUEVO).toContain('NDocumento');
    expect(SELECT_VIEJO).not.toContain('NDocumento');
  });
});

describe('esErrorEsquemaViejo', () => {
  it('reconoce el 400 de propiedad NDocumento inexistente', () => {
    expect(
      esErrorEsquemaViejo(400, "Not supported query option: invalid property 'NDocumento' of entity type 'OLP_IND_VentasB1SLQuery'")
    ).toBe(true);
  });
  it('no confunde otros errores', () => {
    expect(esErrorEsquemaViejo(500, 'Internal server error.')).toBe(false);
    expect(esErrorEsquemaViejo(400, "El nombre de columna 'N° Documento' no es válido.")).toBe(false);
    expect(esErrorEsquemaViejo(400, "invalid property 'Foo'")).toBe(false);
  });
});

describe('caché de la detección', () => {
  beforeEach(() => limpiarCacheEsquema());
  it('separa empresa y ambiente por base URL + CompanyDB', () => {
    const prod = llaveEsquema('https://sl:50000/', 'OLP_PROD');
    const pruebas = llaveEsquema('https://sl:50000', 'z_PRUEBAS_OLP_02102026');
    guardarEsquema(prod, 'nuevo', 0);
    guardarEsquema(pruebas, 'viejo', 0);
    expect(esquemaEnCache(prod, 1)).toBe('nuevo');
    expect(esquemaEnCache(pruebas, 1)).toBe('viejo');
    expect(llaveEsquema('https://SL:50000/', 'olp_prod')).toBe(prod);
  });
  it('vence a los 30 minutos', () => {
    const k = llaveEsquema('https://sl', 'X');
    guardarEsquema(k, 'viejo', 0);
    expect(esquemaEnCache(k, 29 * 60 * 1000)).toBe('viejo');
    expect(esquemaEnCache(k, 31 * 60 * 1000)).toBeNull();
  });
});

describe('normalizarLinea', () => {
  it('esquema nuevo: tipo en NDocumento, llave del documento = asiento', () => {
    const l = normalizarLinea({ Fecha: '2026-11-04', NDocumento: 'Notas Credito', Asiento: 19831, Cantidad: -360, Total: -24334560, Costo: 61158.15, U_IT_LineaTerapeutica: 'AGENTES ANTINEOPLASICOS', Municipio_Factura: 'MEDELLÍN' });
    expect(l.NDocumento).toBe('Notas Credito');
    expect(l.Documento).toBe(19831);
    const f = aFila(l);
    expect(f.t).toBe('N');
    expect(f.d).toBe(19831);
    expect(f.lt).toBe('AGENTES ANTINEOPLASICOS');
    expect(f.ciu).toBe('MEDELLÍN');
  });

  it('respuesta confundida del Service Layer (número bajo la llave Documento): tipo por el signo', () => {
    // Visto en PROD el 2026-11-12: se pidió NDocumento y llegó "Documento": 3961.
    const fac = normalizarLinea({ Fecha: '2026-11-04', Documento: 3961, Asiento: 19754, Cantidad: 144, Total: 414432, Costo: 2067 });
    expect(aFila(fac).t).toBe('F');
    expect(aFila(fac).d).toBe(19754);
    const nota = normalizarLinea({ Fecha: '2026-11-04', Documento: 1526, Asiento: 19806, Cantidad: 0, Total: -3639078 });
    expect(aFila(nota).t).toBe('N');
  });

  it('esquema viejo: tipo en Documento y Descripción con tilde', () => {
    const l = normalizarLinea({ Fecha: '2026-10-02', Documento: 'Facturas ', Asiento: 500, Referencia: '10212', 'Descripción': 'SOLUCION X', Cantidad: 2, Total: 100, Costo: 10 });
    const f = aFila(l, 'viejo');
    expect(f.t).toBe('F');
    expect(f.d).toBe(500);
    expect(f.pn).toBe('SOLUCION X');
    expect(f.lt).toBe('No disponible');
    expect(f.ciu).toBe('No disponible');
    expect(f.oc).toBe('');
  });

  it('sin asiento usa el número que haya llegado', () => {
    expect(normalizarLinea({ NDocumento: 'Facturas', Documento: 77, Total: 1 }).Documento).toBe(77);
    expect(normalizarLinea({ Documento: 'Facturas', Total: 1 }).Documento).toBeUndefined();
  });
});
