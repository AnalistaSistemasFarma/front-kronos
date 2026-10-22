import { describe, expect, it } from 'vitest';
import {
  colorDeUso,
  diaHoraCot,
  horaCot,
  normalizarCuota,
  textoHace,
  textoLiberaCinco,
  textoPorcentaje,
  textoReinicioSemanal,
  vistaCuota,
  type CuotaAgenteDto,
} from '../consumo-anthropic';

/*
 * Medidor del consumo de Anthropic (2026-10-22): validación del reporte del puente, colores por umbral
 * (verde, amarillo desde 70 %, rojo desde 90 %) y textos en hora de Colombia (UTC−5).
 */
const AHORA = new Date('2026-10-22T14:00:00.000Z'); // 9:00 a. m. COT, jueves

describe('normalizarCuota', () => {
  const base = { utilizacion7d: 40, reset7d: '2026-10-23T22:00:00.000Z', utilizacion5h: 22, reset5h: '2026-10-22T16:30:00.000Z', overage: 'rejected', medidoEn: '2026-10-22T13:59:00.000Z', fuente: 'turno' };

  it('acepta el reporte del puente', () => {
    const r = normalizarCuota(base, AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.utilizacion7d).toBe(40);
    expect(r.value.reset5h?.toISOString()).toBe('2026-10-22T16:30:00.000Z');
    expect(r.value.fuente).toBe('turno');
    expect(r.value.overage).toBe('rejected');
  });

  it('acepta una sola ventana y redondea a un decimal', () => {
    const r = normalizarCuota({ utilizacion5h: 19.456, medidoEn: base.medidoEn, fuente: 'sonda' }, AHORA);
    expect(r.ok && r.value.utilizacion5h).toBe(19.5);
    expect(r.ok && r.value.utilizacion7d).toBeNull();
  });

  it.each([
    [null, /objeto JSON/],
    [{ ...base, utilizacion7d: null, utilizacion5h: null }, /ninguna ventana/],
    [{ ...base, utilizacion7d: -1 }, /porcentaje/],
    [{ ...base, utilizacion5h: 'mucho' }, /porcentaje/],
    [{ ...base, utilizacion5h: 5000 }, /porcentaje/],
    [{ ...base, reset7d: 'mañana' }, /ISO/],
    [{ ...base, reset7d: '2027-01-01T00:00:00.000Z' }, /fuera de rango/],
    [{ ...base, medidoEn: undefined }, /medidoEn/],
    [{ ...base, medidoEn: '2026-10-22T15:00:00.000Z' }, /futuro/],
    [{ ...base, fuente: 'manual' }, /fuente/],
  ])('rechaza %#', (payload, error) => {
    const r = normalizarCuota(payload as Record<string, unknown> | null, AHORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(error);
  });

  it('recorta el overage', () => {
    const r = normalizarCuota({ ...base, overage: 'x'.repeat(100) }, AHORA);
    expect(r.ok && r.value.overage?.length).toBe(40);
  });
});

describe('colores y textos', () => {
  it('verde, amarillo desde 70 % y rojo desde 90 %', () => {
    expect(colorDeUso(0)).toBe('green');
    expect(colorDeUso(69.9)).toBe('green');
    expect(colorDeUso(70)).toBe('yellow');
    expect(colorDeUso(89.9)).toBe('yellow');
    expect(colorDeUso(90)).toBe('red');
    expect(colorDeUso(120)).toBe('red');
    expect(colorDeUso(null)).toBe('gray');
  });

  it('porcentaje con coma decimal solo cuando hace falta', () => {
    expect(textoPorcentaje(40)).toBe('40 %');
    expect(textoPorcentaje(99.5)).toBe('99,5 %');
    expect(textoPorcentaje(null)).toBe('—');
  });

  it('hora y día en Colombia (UTC−5)', () => {
    expect(horaCot(new Date('2026-10-22T22:00:00.000Z'))).toBe('5:00 p. m.');
    expect(horaCot(new Date('2026-10-22T05:05:00.000Z'))).toBe('12:05 a. m.');
    expect(horaCot(new Date('2026-10-22T17:30:00.000Z'))).toBe('12:30 p. m.');
    expect(diaHoraCot(new Date('2026-10-23T22:00:00.000Z'))).toBe('vie 23 oct, 5:00 p. m.');
    // 02:00 UTC del 24 = 9:00 p. m. del 23 en Colombia.
    expect(diaHoraCot(new Date('2026-10-24T02:00:00.000Z'))).toBe('vie 23 oct, 9:00 p. m.');
  });

  it('«se reinicia …» y «se libera a las …» (con el día si no es hoy en Colombia)', () => {
    expect(textoReinicioSemanal('2026-10-23T22:00:00.000Z')).toBe('se reinicia vie 23 oct, 5:00 p. m.');
    expect(textoReinicioSemanal(null)).toBeNull();
    expect(textoLiberaCinco('2026-10-22T16:30:00.000Z', AHORA)).toBe('se libera a las 11:30 a. m.');
    expect(textoLiberaCinco('2026-10-23T06:00:00.000Z', AHORA)).toBe('se libera el vie 23 oct, 1:00 a. m.');
    expect(textoLiberaCinco('nada', AHORA)).toBeNull();
  });

  it('«hace …»', () => {
    expect(textoHace('2026-10-22T13:59:40.000Z', AHORA)).toBe('hace menos de un minuto');
    expect(textoHace('2026-10-22T13:57:00.000Z', AHORA)).toBe('hace 3 min');
    expect(textoHace('2026-10-22T11:00:00.000Z', AHORA)).toBe('hace 3 h');
  });
});

describe('vistaCuota', () => {
  const dto: CuotaAgenteDto = {
    code: 'horus',
    displayName: 'Orus',
    utilizacion7d: 92,
    reset7d: '2026-10-23T22:00:00.000Z',
    utilizacion5h: 71,
    reset5h: '2026-10-22T16:30:00.000Z',
    overage: 'rejected',
    medidoEn: '2026-10-22T13:57:00.000Z',
    fuente: 'turno',
  };

  it('dos barras con color, detalle y la línea de la medición', () => {
    const v = vistaCuota(dto, AHORA);
    expect(v.semanal).toMatchObject({ etiqueta: 'Semanal', valor: 92, porcentaje: '92 %', color: 'red', detalle: 'se reinicia vie 23 oct, 5:00 p. m.' });
    expect(v.cinco).toMatchObject({ etiqueta: 'Ventana de 5 h', valor: 71, color: 'yellow', detalle: 'se libera a las 11:30 a. m.' });
    expect(v.medicion).toBe('Medido el jue 22 oct, 8:57 a. m. (hace 3 min) · durante un turno');
    expect(v.vieja).toBe(false);
  });

  it('si el reinicio ya pasó, la ventana vuelve a 0 % y lo dice', () => {
    const v = vistaCuota(dto, new Date('2026-10-22T17:00:00.000Z'));
    expect(v.cinco).toMatchObject({ valor: 0, porcentaje: '0 %', color: 'green', detalle: 'se reinició; esperando la próxima medición' });
    expect(v.semanal?.valor).toBe(92);
    expect(v.vieja).toBe(true);
  });

  it('sin una ventana no pinta su barra; la barra no pasa de 100', () => {
    const v = vistaCuota({ ...dto, utilizacion5h: null, utilizacion7d: 130, fuente: 'sonda' }, AHORA);
    expect(v.cinco).toBeNull();
    expect(v.semanal?.valor).toBe(100);
    expect(v.semanal?.porcentaje).toBe('130 %');
    expect(v.medicion).not.toMatch(/turno/);
  });
});
