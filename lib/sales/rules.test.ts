import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  destinoTrasAprobarPrecios,
  evaluarCupo,
  evaluarEnvio,
  lineasConDiferenciaDePrecio,
  validarLineas,
  type CupoInput,
  type SalesRulesConfig,
} from './rules';

const OLP: SalesRulesConfig = { ...DEFAULT_RULES, validaPrecio: false };

const cupo = (over: Partial<CupoInput> = {}): CupoInput => ({
  client: { creditLimit: 1000, currentAccountBalance: 500, openDeliveryNotesBalance: 100, openOrdersBalance: 100 },
  otrasOfertasEnCupo: 0,
  docTotal: 100,
  ...over,
});

describe('lineasConDiferenciaDePrecio', () => {
  const lines = [
    { itemCode: 'A', unitPrice: 10, listPrice: 10 },
    { itemCode: 'B', unitPrice: 9, listPrice: 10 },
    { itemCode: 'C', unitPrice: 11, listPrice: 10 },
    { itemCode: 'D', unitPrice: 5, listPrice: null },
  ];
  it('por defecto marca cualquier diferencia y el precio de lista vacio (como SAPSEND)', () => {
    expect(lineasConDiferenciaDePrecio(lines).map((l) => l.itemCode)).toEqual(['B', 'C', 'D']);
  });
  it('con precioSoloSiMenor solo marca precios por debajo de la lista', () => {
    const r = lineasConDiferenciaDePrecio(lines, { ...DEFAULT_RULES, precioSoloSiMenor: true });
    expect(r.map((l) => l.itemCode)).toEqual(['B', 'D']);
  });
  it('respeta la tolerancia y el redondeo de la moneda', () => {
    const r = lineasConDiferenciaDePrecio(
      [{ itemCode: 'A', unitPrice: 10.004, listPrice: 10 }, { itemCode: 'B', unitPrice: 10.5, listPrice: 10 }],
      { ...DEFAULT_RULES, toleranciaPrecio: 0.5 }
    );
    expect(r).toEqual([]);
  });
  it('OLP no valida precio', () => {
    expect(lineasConDiferenciaDePrecio(lines, OLP)).toEqual([]);
  });
});

describe('evaluarCupo', () => {
  it('suma saldo, remisiones, pedidos, otras ofertas y la oferta contra limite +20 %', () => {
    expect(evaluarCupo(cupo())).toEqual({ comprometido: 800, limite: 1200, excede: false });
    expect(evaluarCupo(cupo({ otrasOfertasEnCupo: 401 })).excede).toBe(true);
  });
  it('justo en el limite no excede', () => {
    expect(evaluarCupo(cupo({ docTotal: 500 })).excede).toBe(false);
  });
  it('limite 0 hace que cualquier compra exceda', () => {
    const r = evaluarCupo(cupo({ client: { creditLimit: 0, currentAccountBalance: 0, openDeliveryNotesBalance: 0, openOrdersBalance: 0 } }));
    expect(r.excede).toBe(true);
  });
  it('tolera valores no numericos de SAP como 0', () => {
    const r = evaluarCupo({
      client: { creditLimit: 1000, currentAccountBalance: null as never, openDeliveryNotesBalance: 'x' as never, openOrdersBalance: 0 },
      otrasOfertasEnCupo: 0,
      docTotal: 10,
    });
    expect(r.comprometido).toBe(10);
  });
});

describe('evaluarEnvio', () => {
  const precioMal = [{ itemCode: 'A', unitPrice: 9, listPrice: 10 }];
  const precioBien = [{ itemCode: 'A', unitPrice: 10, listPrice: 10 }];
  it('precio distinto va a AP aunque tambien exceda cupo (precio va primero)', () => {
    const r = evaluarEnvio(precioMal, cupo({ otrasOfertasEnCupo: 10_000 }));
    expect(r).toMatchObject({ destino: 'AP', requierePrecio: true, requiereCupo: true });
  });
  it('sin diferencia de precio y excede cupo va a AE', () => {
    expect(evaluarEnvio(precioBien, cupo({ otrasOfertasEnCupo: 10_000 })).destino).toBe('AE');
  });
  it('sin reglas crea el pedido', () => {
    expect(evaluarEnvio(precioBien, cupo()).destino).toBe('PEDIDO');
  });
  it('OLP: solo cupo, un precio distinto no detiene la oferta', () => {
    expect(evaluarEnvio(precioMal, cupo(), OLP).destino).toBe('PEDIDO');
    expect(evaluarEnvio(precioMal, cupo({ otrasOfertasEnCupo: 10_000 }), OLP).destino).toBe('AE');
  });
});

describe('destinoTrasAprobarPrecios', () => {
  it('recalcula el cupo: AE si excede, pedido si no', () => {
    expect(destinoTrasAprobarPrecios(cupo()).destino).toBe('PEDIDO');
    expect(destinoTrasAprobarPrecios(cupo({ docTotal: 5000 })).destino).toBe('AE');
  });
});

describe('validarLineas', () => {
  it('exige lineas, articulo, cantidad > 0 y precio >= 0', () => {
    expect(validarLineas([])).toEqual(['La oferta no tiene lineas.']);
    expect(validarLineas([{ itemCode: 'A', quantity: 1, unitPrice: 0 }])).toEqual([]);
    expect(validarLineas([{ itemCode: ' ', quantity: 0, unitPrice: -1 }])).toHaveLength(3);
  });
});
