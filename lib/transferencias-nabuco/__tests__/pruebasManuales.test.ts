import { describe, expect, it } from 'vitest';
import { esUrlProduccionNabuco } from '../constants';
import { ejemploPayload, MAPEO_ENCABEZADO_DEFECTO, MAPEO_LINEAS_DEFECTO } from '../mapeo';

describe('esUrlProduccionNabuco', () => {
  it('marca la URL de producción de Nabuco', () => {
    expect(esUrlProduccionNabuco('https://NabucoAPI.azurewebsites.net/')).toBe(true);
    expect(esUrlProduccionNabuco('http://40.88.126.40:90')).toBe(false);
    expect(esUrlProduccionNabuco(null)).toBe(false);
  });
});

describe('ejemploPayload', () => {
  it('usa los campos del mapeo: fijos con su valor y campos SAP con muestra', () => {
    const p = ejemploPayload(MAPEO_ENCABEZADO_DEFECTO, MAPEO_LINEAS_DEFECTO, 'items');
    expect(Object.keys(p)).toEqual([...MAPEO_ENCABEZADO_DEFECTO.map((f) => f.campo), 'items']);
    expect(p.nombreTipoOrdenAlistamiento).toBe('Orden alistamiento por defecto');
    expect(p.observaciones).toBe(12345);
    const items = p.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ codigoProducto: 'ART-0001', cantidadRequerida: 1, nombreUnidad: 'Ejemplo MeasureUnit' });
  });
});
