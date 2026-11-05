import { describe, expect, it } from 'vitest';
import { MAPEO_ENCABEZADO_DEFECTO, MAPEO_LINEAS_DEFECTO, construirPayload, leerRuta, validarMapeo } from '../mapeo';

const factura = {
  DocEntry: 10,
  DocNum: 5001,
  DocDate: '2026-10-20',
  Comments: 'Pedido urgente',
  CardName: 'Clínica X',
  ShipToCode: 'BOD-1',
  AddressExtension: { ShipToStreet: 'Calle 1' },
  DocumentLines: [
    { ItemCode: 'A1', Quantity: 3, MeasureUnit: 'UND', BatchNumbers: [{ BatchNumber: 'L1' }] },
    { ItemCode: 'B2', Quantity: 1, MeasureUnit: 'CJ' },
  ],
};

describe('construirPayload', () => {
  it('arma encabezado y líneas con el mapeo por defecto (contrato del legado)', () => {
    const p = construirPayload(factura, 'Invoices', MAPEO_ENCABEZADO_DEFECTO, MAPEO_LINEAS_DEFECTO);
    expect(p.asunto).toBe('Pedido urgente');
    expect(p.observaciones).toBe(5001);
    expect(p.fechaOrden).toBe('2026-10-20');
    expect(p.nombreDestinatarioCliente).toBe('Clínica X');
    expect(p.nombrePuntoEntregaDestinatario).toBe('BOD-1');
    expect(p.claseSolicitud).toBe('C');
    expect(p.enviarA).toBe('D');
    expect(p.items).toEqual([
      { codigoProducto: 'A1', cantidadRequerida: 3, nombreUnidad: 'UND' },
      { codigoProducto: 'B2', cantidadRequerida: 1, nombreUnidad: 'CJ' },
    ]);
  });

  it('admite rutas con punto, filas agregadas y clave de líneas configurable', () => {
    const p = construirPayload(
      factura,
      'Invoices',
      [{ campo: 'direccion', origen: 'campo_sap', valor: 'AddressExtension.ShipToStreet' }],
      [{ campo: 'codigoLote', origen: 'campo_sap', valor: 'BatchNumbers' }, { campo: 'fijo', origen: 'fijo', valor: 'X' }],
      'detalle'
    );
    expect(p.direccion).toBe('Calle 1');
    expect(p.detalle).toEqual([
      { codigoLote: [{ BatchNumber: 'L1' }], fijo: 'X' },
      { codigoLote: null, fijo: 'X' },
    ]);
  });

  it('usa StockTransferLines para las transferencias', () => {
    const p = construirPayload({ StockTransferLines: [{ ItemCode: 'Z', Quantity: 2, MeasureUnit: 'U' }] }, 'StockTransfers', [], MAPEO_LINEAS_DEFECTO);
    expect(p.items).toEqual([{ codigoProducto: 'Z', cantidadRequerida: 2, nombreUnidad: 'U' }]);
  });

  it('campo inexistente queda en null', () => {
    expect(leerRuta(factura, 'NoExiste.Campo')).toBeNull();
  });
});

describe('validarMapeo', () => {
  it('rechaza campos repetidos, orígenes y rutas inválidas', () => {
    expect(() => validarMapeo([{ campo: 'a', origen: 'fijo', valor: '' }, { campo: 'a', origen: 'fijo', valor: '' }], 'x')).toThrow(/repetido/);
    expect(() => validarMapeo([{ campo: 'a', origen: 'otro', valor: '' }], 'x')).toThrow(/origen/);
    expect(() => validarMapeo([{ campo: 'a', origen: 'campo_sap', valor: 'x;DROP' }], 'x')).toThrow(/campo SAP/);
    expect(validarMapeo([{ campo: ' a ', origen: 'campo_sap', valor: 'Doc.Num' }], 'x')).toEqual([{ campo: 'a', origen: 'campo_sap', valor: 'Doc.Num' }]);
  });
});
