import { describe, expect, it } from 'vitest';
import {
  cuadriculaDelMes,
  desdeIso,
  enesimoDiaSemana,
  eventosFijosPorDia,
  fechaLarga,
  fechaValida,
  fechasImportantes,
  festivosColombia,
  hoyEnBogota,
  aIso,
  mesVecino,
  pascua,
  proximos,
  siguienteLunes,
  unirEventos,
  validarEvento,
  type EventoDia,
} from '../calendario';

// Calendario del portal (Cristian Baldión, 2026-10-09). Festivos de Colombia verificados contra el
// calendario oficial (Ley 51 de 1983 y Semana Santa).

const fechas = (año: number) => festivosColombia(año).map((f) => f.fecha);
const nombreDe = (año: number, fecha: string) => festivosColombia(año).find((f) => f.fecha === fecha)?.titulo;

describe('pascua', () => {
  it('coincide con la Pascua real de varios años', () => {
    const real: Record<number, string> = { 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2028: '2028-04-16', 2030: '2030-04-21' };
    for (const [a, f] of Object.entries(real)) expect(aIso(pascua(Number(a))), a).toBe(f);
  });
});

describe('siguienteLunes / enesimoDiaSemana', () => {
  it('un lunes se queda; los demás días pasan al lunes siguiente', () => {
    expect(aIso(siguienteLunes(desdeIso('2026-10-12')))).toBe('2026-10-12'); // lunes
    expect(aIso(siguienteLunes(desdeIso('2026-11-01')))).toBe('2026-11-02'); // domingo
    expect(aIso(siguienteLunes(desdeIso('2026-08-15')))).toBe('2026-08-17'); // sábado
    expect(aIso(siguienteLunes(desdeIso('2026-03-19')))).toBe('2026-03-23'); // jueves
    expect(aIso(siguienteLunes(desdeIso('2026-01-06')))).toBe('2026-01-12'); // martes
  });
  it('el n-ésimo día de la semana del mes', () => {
    expect(aIso(enesimoDiaSemana(2026, 5, 0, 2))).toBe('2026-05-10'); // 2.º domingo de mayo
    expect(aIso(enesimoDiaSemana(2026, 6, 0, 3))).toBe('2026-06-21'); // 3.er domingo de junio
    expect(aIso(enesimoDiaSemana(2026, 9, 6, 3))).toBe('2026-09-19'); // 3.er sábado de septiembre
  });
});

describe('festivosColombia', () => {
  it('2026: los 18 festivos oficiales', () => {
    expect(fechas(2026)).toEqual([
      '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15',
      '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
    ]);
  });
  it('2025: los 18 festivos oficiales', () => {
    expect(fechas(2025)).toEqual([
      '2025-01-01', '2025-01-06', '2025-03-24', '2025-04-17', '2025-04-18', '2025-05-01', '2025-06-02', '2025-06-23', '2025-06-30',
      '2025-06-30', '2025-07-20', '2025-08-07', '2025-08-18', '2025-10-13', '2025-11-03', '2025-11-17', '2025-12-08', '2025-12-25',
    ]);
  });
  it('2027: trae Semana Santa y los trasladados al lunes', () => {
    const f = fechas(2027);
    expect(f).toHaveLength(18);
    expect(f).toContain('2027-03-25'); // Jueves Santo (Pascua 28 de marzo)
    expect(f).toContain('2027-03-26'); // Viernes Santo
    expect(f).toContain('2027-03-22'); // San José, 19 de marzo es viernes → lunes 22
    expect(f).toContain('2027-05-10'); // Ascensión
    expect(f).toContain('2027-05-31'); // Corpus Christi
    expect(f).toContain('2027-06-07'); // Sagrado Corazón
  });
  it('los fijos no se trasladan aunque caigan en fin de semana (25 de dic. de 2027 es sábado)', () => {
    expect(fechas(2027)).toContain('2027-12-25');
    expect(fechas(2027)).toContain('2027-07-20');
  });
  it('cada festivo trae su nombre; Jueves y Viernes Santo no se trasladan', () => {
    expect(nombreDe(2026, '2026-04-02')).toBe('Jueves Santo');
    expect(nombreDe(2026, '2026-04-03')).toBe('Viernes Santo');
    expect(nombreDe(2026, '2026-10-12')).toBe('Día de la Diversidad Étnica y Cultural');
    expect(nombreDe(2026, '2026-11-02')).toBe('Día de Todos los Santos');
  });
  it('todos los festivos "trasladables" caen en lunes', () => {
    const lunes = ['Día de los Reyes Magos', 'Día de San José', 'Ascensión del Señor', 'Corpus Christi', 'Sagrado Corazón de Jesús', 'San Pedro y San Pablo', 'Asunción de la Virgen', 'Día de la Diversidad Étnica y Cultural', 'Día de Todos los Santos', 'Independencia de Cartagena'];
    for (let a = 2020; a <= 2040; a++) {
      for (const f of festivosColombia(a).filter((x) => lunes.includes(x.titulo))) expect(desdeIso(f.fecha).getUTCDay(), `${a} ${f.titulo}`).toBe(1);
    }
  });
});

describe('fechasImportantes', () => {
  it('incluye las fechas laborales y las conmemoraciones de 2026', () => {
    const f = fechasImportantes(2026);
    const por = Object.fromEntries(f.map((e) => [e.titulo, e.fecha]));
    expect(por['Límite para pagar los intereses sobre las cesantías']).toBe('2026-01-31');
    expect(por['Límite para consignar las cesantías en el fondo']).toBe('2026-02-14');
    expect(por['Día de la Madre']).toBe('2026-05-10');
    expect(por['Día del Padre']).toBe('2026-06-21');
    expect(por['Día del Amor y la Amistad']).toBe('2026-09-19');
    expect(por['Límite para pagar la prima de servicios (primer semestre)']).toBe('2026-06-30');
    expect(por['Límite para pagar la prima de servicios (segundo semestre)']).toBe('2026-12-20');
    expect(f.filter((e) => e.tipo === 'laboral')).toHaveLength(4);
  });
});

describe('cuadrícula del mes', () => {
  it('octubre de 2026: 42 celdas, empieza en lunes y marca los días del mes', () => {
    const c = cuadriculaDelMes(2026, 10);
    expect(c).toHaveLength(42);
    expect(c[0]).toEqual({ fecha: '2026-09-28', dia: 28, delMes: false }); // el 1 de octubre es jueves
    expect(c[3]).toEqual({ fecha: '2026-10-01', dia: 1, delMes: true });
    expect(c.filter((x) => x.delMes)).toHaveLength(31);
    expect(desdeIso(c[0].fecha).getUTCDay()).toBe(1);
  });
  it('un mes que empieza en lunes no se corre (junio de 2026)', () => {
    expect(cuadriculaDelMes(2026, 6)[0]).toEqual({ fecha: '2026-06-01', dia: 1, delMes: true });
  });
  it('febrero bisiesto y cambio de año', () => {
    expect(cuadriculaDelMes(2028, 2).filter((x) => x.delMes)).toHaveLength(29);
    expect(cuadriculaDelMes(2026, 12).some((x) => x.fecha === '2027-01-03')).toBe(true);
  });
  it('mes anterior y siguiente cruzan el año', () => {
    expect(mesVecino(2026, 12, 1)).toEqual({ año: 2027, mes: 1 });
    expect(mesVecino(2026, 1, -1)).toEqual({ año: 2025, mes: 12 });
    expect(mesVecino(2026, 10, 1)).toEqual({ año: 2026, mes: 11 });
  });
});

describe('fechas', () => {
  it('fechaValida rechaza lo imposible', () => {
    for (const ok of ['2026-10-09', '2028-02-29']) expect(fechaValida(ok)).toBe(true);
    for (const mal of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-10-9', '09-10-2026', '', null, 20261009, '1999-12-31', '2101-01-01']) expect(fechaValida(mal), String(mal)).toBe(false);
  });
  it('fechaLarga en español', () => {
    expect(fechaLarga('2026-10-09')).toBe('viernes, 9 de octubre de 2026');
    expect(fechaLarga('2026-05-10')).toBe('domingo, 10 de mayo de 2026');
  });
  it('"hoy" se toma en hora de Colombia, no en UTC', () => {
    // 2026-10-10 02:30 UTC todavía es 9 de octubre a las 21:30 en Bogotá (UTC-5).
    expect(hoyEnBogota(new Date('2026-10-10T02:30:00Z'))).toBe('2026-10-09');
    expect(hoyEnBogota(new Date('2026-10-10T05:00:00Z'))).toBe('2026-10-10');
  });
});

describe('unirEventos / proximos', () => {
  const fijos = eventosFijosPorDia([2026]);
  const empresa: EventoDia[] = [
    { id: 1, fecha: '2026-10-12', titulo: 'Jornada de integración', tipo: 'empresa' },
    { id: 2, fecha: '2026-10-20', titulo: 'Capacitación SST', tipo: 'empresa' },
  ];
  it('el festivo va antes que el evento de la empresa del mismo día', () => {
    const t = unirEventos(fijos, empresa);
    expect(t.get('2026-10-12')!.map((e) => e.tipo)).toEqual(['festivo', 'empresa']);
    expect(t.get('2026-10-20')!.map((e) => e.titulo)).toEqual(['Capacitación SST']);
  });
  it('no modifica los fijos originales', () => {
    unirEventos(fijos, empresa);
    expect(fijos.get('2026-10-12')!.every((e) => e.tipo !== 'empresa')).toBe(true);
  });
  it('próximos: los siguientes eventos después de un día', () => {
    const p = proximos(unirEventos(fijos, empresa), '2026-10-09', 3);
    expect(p.map((e) => e.fecha)).toEqual(['2026-10-12', '2026-10-12', '2026-10-20']);
  });
});

describe('validarEvento', () => {
  it('acepta un evento válido y lo limpia', () => {
    const r = validarEvento({ fecha: '2026-10-20', titulo: '  Capacitación \u0000 SST  ', descripcion: ' Sala 2\nTraiga el carné ' });
    expect(r).toEqual({ ok: true, fecha: '2026-10-20', titulo: 'Capacitación SST', descripcion: 'Sala 2\nTraiga el carné' });
  });
  it('la descripción es opcional', () => {
    expect(validarEvento({ fecha: '2026-10-20', titulo: 'X' })).toMatchObject({ ok: true, descripcion: null });
  });
  it('rechaza fecha imposible, título vacío y textos largos', () => {
    expect(validarEvento({ fecha: '2026-02-30', titulo: 'X' })).toMatchObject({ ok: false });
    expect(validarEvento({ fecha: '2026-10-20', titulo: '   ' })).toMatchObject({ ok: false, error: 'Escriba el título del evento.' });
    expect(validarEvento({ fecha: '2026-10-20', titulo: 'x'.repeat(161) })).toMatchObject({ ok: false });
    expect(validarEvento({ fecha: '2026-10-20', titulo: 'X', descripcion: 'y'.repeat(1001) })).toMatchObject({ ok: false });
    for (const x of [null, undefined, 'texto', 5, []]) expect(validarEvento(x).ok).toBe(false);
  });
});
