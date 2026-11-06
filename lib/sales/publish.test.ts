import { describe, expect, it } from 'vitest';
import { addressExtensionOf, buildOrderPayload, normAddr, orderLookupFilter, orderMarker, parseOrderMarker, resolveShipTo, shipFieldsFromBp } from './publish';

describe('marca del pedido', () => {
  it('V<DocEntry> ida y vuelta', () => {
    expect(orderMarker(123)).toBe('V123');
    expect(parseOrderMarker('V123')).toBe(123);
    expect(parseOrderMarker(' V7 ')).toBe(7);
  });
  it('no confunde la marca de Compras ni valores vacios', () => {
    expect(parseOrderMarker('D123')).toBeNull();
    expect(parseOrderMarker(null)).toBeNull();
    expect(parseOrderMarker('V12a')).toBeNull();
  });
  it('filtro OData del pedido de un borrador', () => {
    expect(orderLookupFilter(55)).toBe("U_SEND_SolCom eq 'V55'");
  });
});

describe('buildOrderPayload', () => {
  const base = {
    DocEntry: 900,
    CardCode: 'C001',
    DocDueDate: '2026-11-05',
    Comments: 'Pedido',
    NumAtCard: 'OC-1',
    U_SEND_State: 'AEDA',
    Ignorado: 'x',
  };
  it('pedido en A, con la marca y la fecha de hoy', () => {
    const p = buildOrderPayload({ ...base, DocumentLines: [] }, '2026-10-30');
    expect(p).toMatchObject({
      CardCode: 'C001',
      DocDate: '2026-10-30',
      DocDueDate: '2026-11-05',
      DocObjectCode: 'oOrders',
      U_SEND_State: 'A',
      U_SEND_SolCom: 'V900',
      NumAtCard: 'OC-1',
    });
    expect(p).not.toHaveProperty('Ignorado');
  });
  it('lineas de Salesforce sin cotizacion: no inventa la base', () => {
    const p = buildOrderPayload(
      { ...base, DocumentLines: [{ ItemCode: 'A', Quantity: 2, UnitPrice: 10, WarehouseCode: 'B1101' }] },
      '2026-10-30'
    );
    expect(p.DocumentLines[0]).toEqual({ ItemCode: 'A', Quantity: 2, WarehouseCode: 'B1101', TaxCode: undefined, UnitPrice: 10 });
  });
  it('lineas con cotizacion conservan su propia base', () => {
    const p = buildOrderPayload(
      {
        ...base,
        DocumentLines: [
          { ItemCode: 'A', Quantity: 1, Price: 5, BaseType: 23, BaseEntry: 40, BaseLine: 0 },
          { ItemCode: 'B', Quantity: 1, UnitPrice: 6, BaseType: 23, BaseEntry: 40, BaseLine: 3 },
        ],
      },
      '2026-10-30'
    );
    expect(p.DocumentLines.map((l) => [l.UnitPrice, l.BaseEntry, l.BaseLine])).toEqual([
      [5, 40, 0],
      [6, 40, 3],
    ]);
  });
});

describe('dirección del pedido (regresión 2026-11-05, pedidos 2782/2783 de pruebas OLP)', () => {
  // AddressExtension tal como lo devuelve SAP en el borrador 892.
  const ext = {
    ShipToStreet: 'CR 13 1 NORTE 35',
    ShipToStreetNo: null,
    ShipToCity: 'ARMENIA',
    ShipToZipCode: '630001',
    ShipToState: '63',
    ShipToCountry: 'CO',
    ShipToAddressType: null,
    BillToStreet: 'CR 13 1 NORTE 35',
    BillToCity: 'ARMENIA',
    BillToZipCode: '630001',
    BillToState: '63',
    BillToCountry: 'CO',
    PlaceOfSupply: null,
    DocEntry: 892,
    GoodsIssuePlaceCity: null,
    DeliveryPlaceCity: 'X',
    U_HBT_MunMedS: '63001',
    U_HBT_MunMedB: '63001',
    U_HBT_DirMMS: 'N',
    U_HBT_DirMMB: 'Y',
  };
  const texto = 'CR 13 1 NORTE 35\r630001  ARMENIA\rCOLOMBIA';
  const draft = { DocEntry: 892, CardCode: '900848340', ShipToCode: 'ARMENIA', PayToCode: 'FACTURACION', Address2: texto, AddressExtension: ext };

  it('copia AddressExtension completo de envío y facturación con las UDF de municipio', () => {
    const p = buildOrderPayload(draft, '2026-11-05') as Record<string, unknown>;
    expect(p.AddressExtension).toEqual({
      ShipToStreet: 'CR 13 1 NORTE 35',
      ShipToCity: 'ARMENIA',
      ShipToZipCode: '630001',
      ShipToState: '63',
      ShipToCountry: 'CO',
      BillToStreet: 'CR 13 1 NORTE 35',
      BillToCity: 'ARMENIA',
      BillToZipCode: '630001',
      BillToState: '63',
      BillToCountry: 'CO',
      U_HBT_MunMedS: '63001',
      U_HBT_MunMedB: '63001',
      U_HBT_DirMMS: 'N',
      U_HBT_DirMMB: 'Y',
    });
    expect(p).toMatchObject({ ShipToCode: 'ARMENIA', PayToCode: 'FACTURACION' });
  });
  it('quita nulos, DocEntry y campos ajenos (GoodsIssuePlace*, DeliveryPlace*, PlaceOfSupply)', () => {
    const a = addressExtensionOf(draft)!;
    expect(a).not.toHaveProperty('DocEntry');
    expect(a).not.toHaveProperty('ShipToStreetNo');
    expect(a).not.toHaveProperty('DeliveryPlaceCity');
    expect(a).not.toHaveProperty('PlaceOfSupply');
  });
  it('con componentes de envío NO manda Address2 (SAP dejaba vacía la dirección del pedido)', () => {
    expect(buildOrderPayload(draft, '2026-11-05')).not.toHaveProperty('Address2');
  });
  it('sin componentes de envío conserva el texto Address2', () => {
    const p = buildOrderPayload({ DocEntry: 1, CardCode: 'C', Address2: texto, AddressExtension: { ShipToStreet: null } }, '2026-11-05');
    expect(p).toMatchObject({ Address2: texto });
    expect(p).not.toHaveProperty('AddressExtension');
  });
  it('borrador sin ShipToCode pero con dirección completa (893): pedido con componentes', () => {
    const p = buildOrderPayload({ ...draft, ShipToCode: null }, '2026-11-05') as Record<string, unknown>;
    expect(p).not.toHaveProperty('ShipToCode');
    expect((p.AddressExtension as Record<string, unknown>).U_HBT_MunMedS).toBe('63001');
  });
});

// Ficha del cliente 900149596 en pruebas OLP (2026-11-05): ShipToDefault BOGOTA y otras direcciones de envío.
const bp = {
  ShipToDefault: 'BOGOTA',
  BPAddresses: [
    { AddressName: 'BOGOTA', AddressType: 'bo_ShipTo', Street: 'CR 47 91 84', City: 'BOGOTÁ', ZipCode: '111211', State: '25', Country: 'CO', County: null, U_HBT_MunMed: '11001', U_HBT_DirMM: 'N' },
    { AddressName: 'FACTURACION', AddressType: 'bo_BillTo', Street: 'CR 47 93 58', City: 'BOGOTÁ', ZipCode: '111211', State: '25', Country: 'CO', U_HBT_MunMed: '11001', U_HBT_DirMM: 'Y' },
    { AddressName: 'MEDELLÍN', AddressType: 'bo_ShipTo', Street: 'CL 67 A 51 B 27', City: 'MEDELLÍN', ZipCode: '050001', State: '5', Country: 'CO', U_HBT_MunMed: '05001', U_HBT_DirMM: 'N' },
  ],
};
// Borrador 902 de Ceiba: sin ShipToCode y con un AddressExtension parcial (sin código postal, departamento, país ni municipio).
const draft902 = {
  DocEntry: 902,
  CardCode: '900149596',
  ShipToCode: null,
  PayToCode: 'FACTURACION',
  Address2: 'CL 67 A 51 B 27\rMEDELLÍN\rCOLOMBIA',
  AddressExtension: { ShipToStreet: 'CL 67 A 51 B 27', ShipToStreetNo: '7', ShipToCity: 'MEDELLÍN', ShipToCounty: 'Antioquia', ShipToZipCode: null, U_HBT_DirMMS: 'N', U_HBT_MunMedB: '11001' },
};

describe('RN 2026-11-05: el pedido siempre lleva ShipToCode', () => {
  it('normaliza mayúsculas, tildes y espacios', () => {
    expect(normAddr('  Medellín   ')).toBe('MEDELLIN');
    expect(normAddr('cl 67  a 51 b 27')).toBe('CL 67 A 51 B 27');
  });
  it('si el borrador trae ShipToCode, se usa ese', () => {
    expect(resolveShipTo({ ...draft902, ShipToCode: 'BOGOTA' }, bp)).toMatchObject({ code: 'BOGOTA', via: 'borrador' });
  });
  it('sin ShipToCode: la dirección de envío con la misma calle y ciudad (aunque cambien tildes y mayúsculas)', () => {
    const ext = { ...draft902.AddressExtension, ShipToStreet: 'cl 67 a  51 b 27', ShipToCity: 'Medellin' };
    expect(resolveShipTo({ ...draft902, AddressExtension: ext }, bp)).toMatchObject({ code: 'MEDELLÍN', via: 'coincidencia' });
  });
  it('sin coincidencia: la ShipToDefault del cliente', () => {
    const ext = { ShipToStreet: 'CALLE NUEVA 1', ShipToCity: 'MEDELLÍN' };
    expect(resolveShipTo({ ...draft902, AddressExtension: ext }, bp)).toMatchObject({ code: 'BOGOTA', via: 'defecto' });
    expect(resolveShipTo({ DocEntry: 1, CardCode: 'C' }, bp)).toMatchObject({ code: 'BOGOTA', via: 'defecto' });
  });
  it('sin ShipToDefault: la primera dirección de envío; nunca la de facturación', () => {
    const r = resolveShipTo({ DocEntry: 1, CardCode: 'C' }, { ShipToDefault: null, BPAddresses: bp.BPAddresses.slice(1) });
    expect(r).toMatchObject({ code: 'MEDELLÍN', via: 'defecto' });
  });
  it('cliente sin direcciones de envío: sin ShipToCode', () => {
    expect(resolveShipTo(draft902, { ShipToDefault: null, BPAddresses: [bp.BPAddresses[1]] })).toEqual({ code: null, via: 'ninguna', address: null });
    expect(resolveShipTo(draft902, null)).toEqual({ code: null, via: 'ninguna', address: null });
  });
  it('mapea la dirección de la ficha a los campos de envío del documento', () => {
    expect(shipFieldsFromBp(bp.BPAddresses[2])).toEqual({
      ShipToStreet: 'CL 67 A 51 B 27',
      ShipToCity: 'MEDELLÍN',
      ShipToZipCode: '050001',
      ShipToState: '5',
      ShipToCountry: 'CO',
      U_HBT_MunMedS: '05001',
      U_HBT_DirMMS: 'N',
    });
  });
  it('payload: ShipToCode resuelto; lo que llega manda y lo que falta viene de la ficha (SAP no lo completa solo)', () => {
    const p = buildOrderPayload(draft902 as never, '2026-11-05', bp) as Record<string, unknown>;
    expect(p.ShipToCode).toBe('MEDELLÍN');
    expect(p.AddressExtension).toMatchObject({
      ShipToStreet: 'CL 67 A 51 B 27',
      ShipToStreetNo: '7',
      ShipToCounty: 'Antioquia',
      ShipToZipCode: '050001',
      ShipToState: '5',
      ShipToCountry: 'CO',
      U_HBT_MunMedS: '05001',
      U_HBT_MunMedB: '11001',
    });
    expect(p).not.toHaveProperty('Address2');
  });
  it('lo que llega en el borrador no se pisa con la ficha', () => {
    const d = { ...draft902, AddressExtension: { ...draft902.AddressExtension, ShipToZipCode: '050021', U_HBT_MunMedS: '05002' } };
    const p = buildOrderPayload(d as never, '2026-11-05', bp) as Record<string, unknown>;
    expect(p.AddressExtension).toMatchObject({ ShipToZipCode: '050021', U_HBT_MunMedS: '05002', ShipToState: '5' });
  });
  it('cliente sin direcciones de envío: el pedido sale sin ShipToCode con lo que llegue (no bloquea)', () => {
    const p = buildOrderPayload(draft902 as never, '2026-11-05', { BPAddresses: [] }) as Record<string, unknown>;
    expect(p).not.toHaveProperty('ShipToCode');
    expect(p.AddressExtension).toMatchObject({ ShipToStreet: 'CL 67 A 51 B 27', ShipToCity: 'MEDELLÍN' });
    expect(p.AddressExtension).not.toHaveProperty('ShipToZipCode');
  });
});
