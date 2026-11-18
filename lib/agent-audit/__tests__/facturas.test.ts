import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fechaIngles, leerFacturaAnthropic, periodoIngles, sugerirReparto, totalesDelAnio, type FacturaResumenDto } from '../facturas';

const TEXTO = readFileSync(join(__dirname, 'fixtures', 'factura-anthropic-team.txt'), 'utf8');

/** Mismo contenido como lo entrega el navegador (pdfjs): celdas de una fila unidas con « | ». */
const NAVEGADOR = `Invoice
Invoice number | 4BIGCYYD-0008
Date of issue | October 22, 2026
Date due | October 22, 2026
Anthropic, PBC | Bill to
548 Market Street | Gsslatam
support@anthropic.com | automatizacion@gsslatam.com
$850.00 USD due October 22, 2026
Description | Qty | Unit price | Amount
Team plan - Premium | 5 | $125.00 | $625.00
Oct 22–Nov 22, 2026
Team plan - Standard | 9 | $25.00 | $225.00
Oct 22–Nov 22, 2026
Subtotal | $850.00
Total | $850.00
Amount due | $850.00 USD`;

describe('facturas de IA', () => {
  it('lee una factura del plan Team de Anthropic (texto del PDF)', () => {
    const f = leerFacturaAnthropic(TEXTO);
    expect(f).toMatchObject({
      proveedor: 'Anthropic',
      numero: '4BIGCYYD-0008',
      fecha: '2026-10-22',
      vence: '2026-10-22',
      periodoDesde: '2026-10-22',
      periodoHasta: '2026-11-22',
      facturadoA: 'Gsslatam',
      correoCuenta: 'automatizacion@gsslatam.com',
      moneda: 'USD',
      subtotal: 850,
      total: 850,
    });
    expect(f.lineas).toEqual([
      { descripcion: 'Team plan - Premium', periodo: 'Oct 22–Nov 22, 2026', cantidad: 5, precioUnitario: 125, monto: 625 },
      { descripcion: 'Team plan - Standard', periodo: 'Oct 22–Nov 22, 2026', cantidad: 9, precioUnitario: 25, monto: 225 },
    ]);
  });

  it('lee la misma factura con el formato del navegador', () => {
    const f = leerFacturaAnthropic(NAVEGADOR);
    expect(f.numero).toBe('4BIGCYYD-0008');
    expect(f.total).toBe(850);
    expect(f.lineas.map((l) => [l.descripcion, l.periodo, l.monto])).toEqual([
      ['Team plan - Premium', 'Oct 22–Nov 22, 2026', 625],
      ['Team plan - Standard', 'Oct 22–Nov 22, 2026', 225],
    ]);
  });

  it('fechas y períodos en inglés', () => {
    expect(fechaIngles('September 3, 2026')).toBe('2026-09-03');
    expect(periodoIngles('Dec 22–Jan 22, 2027')).toEqual({ desde: '2026-12-22', hasta: '2027-01-22' });
    expect(fechaIngles('mañana')).toBeNull();
  });

  it('reparto sugerido proporcional al costo de las licencias por empresa, cuadrado a centavos', () => {
    const r = sugerirReparto(850, { idEmpresa: 8, empresa: 'GSS' }, [
      { idEmpresa: 8, empresa: 'GSS', costoMensual: 125 },
      { idEmpresa: 8, empresa: 'GSS', costoMensual: 25 },
      { idEmpresa: 2, empresa: 'LABORATORIOS RYAN', costoMensual: 25 },
      { idEmpresa: 3, empresa: 'ONELATAMPHARMA', costoMensual: null },
    ]);
    expect(r).toEqual([
      { idEmpresa: 8, empresa: 'GSS', monto: 728.57 },
      { idEmpresa: 2, empresa: 'LABORATORIOS RYAN', monto: 121.43 },
    ]);
    expect(sugerirReparto(100, { idEmpresa: 8, empresa: 'GSS' }, [])).toEqual([{ idEmpresa: 8, empresa: 'GSS', monto: 100 }]);
  });

  it('totales del año: lo pagado por empresa y lo que le corresponde según el reparto', () => {
    const base = { proveedor: 'Anthropic', vence: null, periodoDesde: null, periodoHasta: null, facturadoA: null, correoCuenta: null, organizacion: null, moneda: 'USD', subtotal: null, impuestos: null, estado: 'pagada', notas: null, tienePdf: false, pdfNombre: null, lineas: [] };
    const f: FacturaResumenDto[] = [
      { ...base, idFactura: 1, numero: 'A', fecha: '2026-10-22', idEmpresa: 8, empresa: 'GSS', total: 850, reparto: [
        { idEmpresa: 8, empresa: 'GSS', monto: 700, fuente: 'licencias' },
        { idEmpresa: 2, empresa: 'RYAN', monto: 150, fuente: 'licencias' },
      ] },
      { ...base, idFactura: 2, numero: 'B', fecha: '2026-09-22', idEmpresa: 3, empresa: 'OLP', total: 200, reparto: [] },
      { ...base, idFactura: 3, numero: 'C', fecha: '2025-12-22', idEmpresa: 8, empresa: 'GSS', total: 999, reparto: [] },
    ];
    const t = totalesDelAnio(2026, f);
    expect(t.total).toBe(1050);
    expect(t.sinReparto).toBe(1);
    expect(t.porEmpresa).toEqual([
      { idEmpresa: 8, empresa: 'GSS', pagado: 850, corresponde: 700, facturas: 1 },
      { idEmpresa: 3, empresa: 'OLP', pagado: 200, corresponde: 200, facturas: 1 },
      { idEmpresa: 2, empresa: 'RYAN', pagado: 0, corresponde: 150, facturas: 0 },
    ]);
    expect(t.porMes[9].total).toBe(850);
    expect(t.porProveedor).toEqual([{ proveedor: 'Anthropic', total: 1050, facturas: 2 }]);
  });
});
