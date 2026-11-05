import { describe, expect, it } from 'vitest';
import { addressExtensionOf, buildOrderPayload, orderLookupFilter, orderMarker, parseOrderMarker, shipAddressProblem } from './publish';

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

describe('shipAddressProblem', () => {
  it('con ShipToCode no hay problema', () => {
    expect(shipAddressProblem({ DocEntry: 1, ShipToCode: 'ARMENIA' })).toBeNull();
  });
  it('sin ShipToCode pero con código postal y municipio no hay problema', () => {
    expect(shipAddressProblem({ DocEntry: 1, AddressExtension: { ShipToZipCode: '630001', U_HBT_MunMedS: '63001' } })).toBeNull();
  });
  it('sin ShipToCode ni municipio: revisar dirección', () => {
    expect(shipAddressProblem({ DocEntry: 7, ShipToCode: '', AddressExtension: { ShipToZipCode: '630001', U_HBT_MunMedS: null } })).toMatch(
      /^Revisar dirección: el borrador 7 .*municipio/
    );
  });
  it('sin ninguna dirección: revisar dirección', () => {
    expect(shipAddressProblem({ DocEntry: 8 })).toMatch(/código postal ni municipio/);
  });
});
