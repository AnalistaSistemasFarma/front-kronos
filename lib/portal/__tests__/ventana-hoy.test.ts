import { describe, expect, it } from 'vitest';
import { cumpleanosComoEventos, type EventoDia } from '../calendario';
import { IMAGEN_CUMPLEANOS, SEGUNDOS_VENTANA_HOY, claveVentanaHoy, eventosDelDia, hayCumpleanos } from '../ventana-hoy';

// Ventana emergente «Hoy» (Cristian Baldión, 2026-10-15).

const cumple = (fecha: string) => cumpleanosComoEventos([{ fecha, personas: [{ nombre: 'PEREZ GOMEZ ANA', empresa: 'GSS SAS', area: 'SISTEMAS' }] }]);
const empresa = (fecha: string, titulo: string): EventoDia => ({ id: 1, fecha, titulo, tipo: 'empresa', descripcion: 'Auditorio' });

describe('constantes', () => {
  it('se cierra a los 15 segundos; la imagen es la de cumpleaños; la clave lleva la fecha', () => {
    expect(SEGUNDOS_VENTANA_HOY).toBe(15);
    expect(IMAGEN_CUMPLEANOS).toBe('/portal-th/cumpleanos.svg');
    expect(claveVentanaHoy('2026-10-15')).toBe('portal-th-ventana-hoy-2026-10-15');
    expect(claveVentanaHoy('2026-10-15')).not.toBe(claveVentanaHoy('2026-10-16'));
  });
});

describe('eventosDelDia', () => {
  it('un día sin nada: lista vacía (la ventana no se abre)', () => {
    expect(eventosDelDia('2026-10-15', [], [])).toEqual([]);
  });
  it('un festivo se calcula igual que en el calendario', () => {
    const e = eventosDelDia('2026-12-25', [], []);
    expect(e.map((x) => [x.titulo, x.tipo])).toEqual([['Navidad', 'festivo']]);
  });
  it('festivo + fecha importante el mismo día: solo los de ESE día y en el orden del calendario', () => {
    // 20 de diciembre: límite de la prima (laboral); 25: Navidad (festivo)
    const e = eventosDelDia('2026-12-20', [empresa('2026-12-20', 'Cena de fin de año')], []);
    expect(e.map((x) => x.tipo)).toEqual(['laboral', 'empresa']);
  });
  it('trae los eventos de la empresa de hoy y descarta los de otros días', () => {
    const e = eventosDelDia('2026-10-15', [empresa('2026-10-15', 'Capacitación SST'), empresa('2026-10-16', 'Otro día')], []);
    expect(e.map((x) => x.titulo)).toEqual(['Capacitación SST']);
  });
  it('los cumpleaños van al final y solo los de hoy', () => {
    const e = eventosDelDia('2026-12-25', [empresa('2026-12-25', 'Almuerzo')], [...cumple('2026-12-25'), ...cumple('2026-12-26')]);
    expect(e.map((x) => x.titulo)).toEqual(['Navidad', 'Almuerzo', 'CUMPLEAÑOS']);
    expect(e[2].personas).toHaveLength(1);
  });
  it('un día con cumpleaños pero sin personas no cuenta', () => {
    expect(eventosDelDia('2026-10-15', [], [{ fecha: '2026-10-15', titulo: 'CUMPLEAÑOS', tipo: 'conmemoracion', personas: [] }])).toEqual([]);
  });
  it('funciona en año bisiesto y de cambio de año', () => {
    expect(eventosDelDia('2028-02-29', [], cumple('2028-02-29')).map((x) => x.titulo)).toEqual(['CUMPLEAÑOS']);
    expect(eventosDelDia('2027-01-01', [], []).map((x) => x.titulo)).toEqual(['Año Nuevo']);
  });
});

describe('hayCumpleanos', () => {
  it('solo es cierto con el evento CUMPLEAÑOS y personas', () => {
    expect(hayCumpleanos(eventosDelDia('2026-10-15', [], cumple('2026-10-15')))).toBe(true);
    expect(hayCumpleanos(eventosDelDia('2026-12-25', [], []))).toBe(false);
    expect(hayCumpleanos([])).toBe(false);
    expect(hayCumpleanos([{ fecha: '2026-10-15', titulo: 'CUMPLEAÑOS', tipo: 'conmemoracion', personas: [] }])).toBe(false);
  });
});
