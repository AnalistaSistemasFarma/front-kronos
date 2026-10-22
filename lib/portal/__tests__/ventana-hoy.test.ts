import { describe, expect, it } from 'vitest';
import { cumpleanosComoEventos, type EventoDia } from '../calendario';
import {
  DIAS_PROXIMOS_VENTANA_HOY,
  IMAGEN_CUMPLEANOS,
  MAX_PROXIMOS_VENTANA_HOY,
  PREFIJO_MARCA_VENTANA_HOY,
  SEGUNDOS_VENTANA_HOY,
  claveVentanaHoy,
  eventosDelDia,
  finDeProximos,
  hayCumpleanos,
  omitirPorMarca,
  proximosEventos,
  reiniciarVentanaHoy,
} from '../ventana-hoy';

// Ventana emergente «Hoy» (Cristian Baldión, 2026-10-15).

const cumple = (fecha: string) => cumpleanosComoEventos([{ fecha, personas: [{ nombre: 'PEREZ GOMEZ ANA', empresa: 'GSS SAS', cargo: 'ANALISTA DE SISTEMAS' }] }]);
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
  it('un día sin nada: lista vacía (la ventana sale igual, con el estado vacío y los próximos)', () => {
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

describe('reiniciarVentanaHoy (cada inicio de sesión, Cristian 2026-10-16)', () => {
  const almacenFalso = (inicial: Record<string, string>) => {
    const datos = new Map(Object.entries(inicial));
    return {
      datos,
      get length() {
        return datos.size;
      },
      key: (i: number) => [...datos.keys()][i] ?? null,
      removeItem: (k: string) => void datos.delete(k),
    };
  };
  it('borra la marca de «ya vista» de TODOS los días y no toca ninguna otra cosa del almacenamiento', () => {
    const a = almacenFalso({ [claveVentanaHoy('2026-10-14')]: '1', [claveVentanaHoy('2026-10-15')]: '1', otra: 'x', 'portal-th-ventana': 'y' });
    reiniciarVentanaHoy(a);
    expect([...a.datos.keys()].sort()).toEqual(['otra', 'portal-th-ventana']);
    expect(PREFIJO_MARCA_VENTANA_HOY).toBe('portal-th-ventana-hoy-');
  });
  it('sin marcas o sin almacenamiento no hace nada ni lanza', () => {
    expect(() => reiniciarVentanaHoy(almacenFalso({}))).not.toThrow();
    expect(() => reiniciarVentanaHoy(null)).not.toThrow();
    const roto = { length: 1, key: () => { throw new Error('bloqueado'); }, removeItem: () => undefined };
    expect(() => reiniciarVentanaHoy(roto)).not.toThrow();
  });
});

describe('omitirPorMarca (marcas viejas de la versión de una vez por día)', () => {
  it('en un navegador REAL la marca se ignora siempre; solo un navegador automatizado la respeta', () => {
    expect(omitirPorMarca(true, false)).toBe(false); // marca vieja en el navegador de una persona: la ventana sale
    expect(omitirPorMarca(false, false)).toBe(false);
    expect(omitirPorMarca(true, true)).toBe(true); // interruptor de las pruebas automáticas
    expect(omitirPorMarca(false, true)).toBe(false);
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

describe('proximosEventos (día sin nada: «que salga siempre», Cristian 2026-10-21)', () => {
  it('rango: los próximos 30 días, máximo 5', () => {
    expect(DIAS_PROXIMOS_VENTANA_HOY).toBe(30);
    expect(MAX_PROXIMOS_VENTANA_HOY).toBe(5);
    expect(finDeProximos('2026-10-15')).toBe('2026-11-14');
    expect(finDeProximos('2026-12-20')).toBe('2027-01-19'); // cruza el año
  });
  it('trae festivos, eventos y cumpleaños después de hoy, en orden de fecha y sin contar hoy', () => {
    const e = proximosEventos('2026-10-15', [empresa('2026-10-15', 'Hoy no'), empresa('2026-10-20', 'Capacitación SST')], [...cumple('2026-10-15'), ...cumple('2026-10-18')]);
    expect(e.map((x) => [x.fecha, x.titulo])).toEqual([
      ['2026-10-18', 'CUMPLEAÑOS'],
      ['2026-10-20', 'Capacitación SST'],
      ['2026-11-02', 'Día de Todos los Santos'],
    ]); // el 16 de noviembre (Independencia de Cartagena) ya queda fuera de los 30 días
  });
  it('máximo 5 y nada más allá de los 30 días', () => {
    const muchos = ['2026-10-16', '2026-10-17', '2026-10-19', '2026-10-21', '2026-10-22', '2026-10-23'].map((f) => empresa(f, `Evento ${f}`));
    expect(proximosEventos('2026-10-15', muchos, [])).toHaveLength(5);
    expect(proximosEventos('2026-10-15', [empresa('2026-11-20', 'Lejos')], []).some((x) => x.titulo === 'Lejos')).toBe(false);
  });
  it('un cumpleaños sin personas no cuenta', () => {
    const e = proximosEventos('2026-10-15', [], [{ fecha: '2026-10-16', titulo: 'CUMPLEAÑOS', tipo: 'conmemoracion', personas: [] }]);
    expect(e.some((x) => x.titulo === 'CUMPLEAÑOS')).toBe(false);
  });
  it('cruza el año: después del 20 de diciembre trae Navidad y Año Nuevo', () => {
    const e = proximosEventos('2026-12-20', [], []);
    expect(e.map((x) => x.titulo)).toContain('Navidad');
    expect(e.map((x) => x.titulo)).toContain('Año Nuevo');
    expect(e.every((x) => x.fecha > '2026-12-20' && x.fecha <= '2027-01-19')).toBe(true);
  });
});
