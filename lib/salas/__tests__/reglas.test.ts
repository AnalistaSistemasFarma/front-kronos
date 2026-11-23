import { describe, expect, it } from 'vitest';
import { esSoloLectura, parseSalas, salasPublicas, MENSAJE_SOLO_LECTURA } from '../config';
import { esFecha, hoyBogota, msBogota, rangoDias, sumarAnios } from '../fechas';
import { isSalasMarkerSubprocess, nivelDesdeUrls, puedeCancelar } from '../permisos';
import {
  ErrorReserva,
  detectarChoques,
  exigirEscritura,
  expandirFechas,
  ocurrencias,
  parseInvitados,
  patronGraph,
  validarNoPasado,
  validarSolicitud,
  validarVentana,
  type EventoExistente,
} from '../reglas';

function atrapar(fn: () => unknown): ErrorReserva {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorReserva) return e;
    throw e;
  }
  throw new Error('no lanzó');
}

describe('fechas', () => {
  it('valida fechas reales', () => {
    expect(esFecha('2026-11-17')).toBe(true);
    expect(esFecha('2026-02-30')).toBe(false);
    expect(esFecha('17/11/2026')).toBe(false);
  });
  it('hoy en Bogotá respeta el offset -05:00', () => {
    expect(hoyBogota(new Date('2026-11-18T03:00:00Z'))).toBe('2026-11-17');
    expect(hoyBogota(new Date('2026-11-18T05:00:00Z'))).toBe('2026-11-18');
  });
  it('el rango de calendarView lleva offset -05:00', () => {
    expect(rangoDias('2026-11-17')).toEqual({
      inicio: '2026-11-17T00:00:00-05:00',
      fin: '2026-11-18T00:00:00-05:00',
    });
  });
  it('29 de febrero + 1 año pasa al 28', () => {
    expect(sumarAnios('2028-02-29', 1)).toBe('2029-02-28');
  });
});

describe('configuración de salas', () => {
  const raw =
    'salaadm1@gsslatam.com|Sala administrativa 1;quietroom@gsslatam.com|Quiet Room;invitados1@gsslatam.com|Sala invitados 1|30;malo|X';
  it('lee SALAS_ROOMS con ventanas por defecto, conocidas y explícitas', () => {
    const salas = parseSalas(raw);
    expect(salas.map((s) => [s.id, s.ventanaDias])).toEqual([
      ['salaadm1', 15],
      ['quietroom', 10],
      ['invitados1', 30],
    ]);
  });
  it('SALAS_VENTANA_DIAS permite ampliar la ventana (por ejemplo a 365)', () => {
    const salas = parseSalas(raw, 'quietroom@gsslatam.com|365');
    expect(salas.find((s) => s.id === 'quietroom')?.ventanaDias).toBe(365);
  });
  it('la vista pública no expone el buzón', () => {
    expect(JSON.stringify(salasPublicas(parseSalas(raw)))).not.toContain('@');
  });
});

describe('permisos', () => {
  it('toma el nivel más alto', () => {
    expect(nivelDesdeUrls(['/process/salas'])).toBe('ver');
    expect(nivelDesdeUrls(['/process/salas', '/process/salas/reservar'])).toBe('reservar');
    expect(nivelDesdeUrls(['/process/salas/admin/'])).toBe('admin');
    expect(nivelDesdeUrls(['/process/otro'])).toBeNull();
  });
  it('cancela el organizador con permiso de reservar, o el administrador', () => {
    expect(puedeCancelar('reservar', 'a@gss.com', 'A@gss.com')).toBe(true);
    expect(puedeCancelar('reservar', 'a@gss.com', 'b@gss.com')).toBe(false);
    expect(puedeCancelar('ver', 'a@gss.com', 'a@gss.com')).toBe(false);
    expect(puedeCancelar('admin', 'a@gss.com', 'b@gss.com')).toBe(true);
  });
  it('los marcadores no salen en el hub', () => {
    expect(isSalasMarkerSubprocess({ subprocess_url: '/process/salas/reservar' })).toBe(true);
    expect(isSalasMarkerSubprocess({ subprocess_url: '/process/salas/admin' })).toBe(true);
    expect(isSalasMarkerSubprocess({ subprocess_url: '/process/salas' })).toBe(false);
  });
});

describe('solicitud e invitados', () => {
  const base = {
    salaId: 'salaadm1',
    fecha: '2026-11-20',
    horaInicio: '09:00',
    horaFin: '10:00',
    asunto: 'Comité',
    invitados: '',
    repeticion: { tipo: 'ninguna' as const },
  };
  it('el fin debe ser posterior al inicio', () => {
    expect(atrapar(() => validarSolicitud({ ...base, horaFin: '09:00' })).message).toMatch(/posterior/);
  });
  it('invitados separados por coma, sin repetidos', () => {
    expect(parseInvitados('a@gss.com, B@gss.com ,a@gss.com')).toEqual(['a@gss.com', 'b@gss.com']);
  });
  it('rechaza correos inválidos y el punto y coma', () => {
    expect(() => parseInvitados('a@gss.com; b@gss.com')).toThrow(ErrorReserva);
    expect(() => parseInvitados('no-es-correo')).toThrow(/no válido/);
  });
});

describe('expansión de series', () => {
  it('simple: una fecha', () => {
    expect(expandirFechas('2026-11-20', { tipo: 'ninguna' })).toEqual(['2026-11-20']);
  });
  it('diaria de lunes a viernes salta el fin de semana', () => {
    expect(expandirFechas('2026-11-20', { tipo: 'diaria', soloHabiles: true, hasta: '2026-11-24' })).toEqual([
      '2026-11-20',
      '2026-11-23',
      '2026-11-24',
    ]);
  });
  it('diaria todos los días', () => {
    expect(expandirFechas('2026-11-20', { tipo: 'diaria', hasta: '2026-11-22' })).toHaveLength(3);
  });
  it('semanal en varios días', () => {
    // 2026-11-16 es lunes
    expect(
      expandirFechas('2026-11-16', { tipo: 'semanal', diasSemana: [1, 3], hasta: '2026-11-25' })
    ).toEqual(['2026-11-16', '2026-11-18', '2026-11-23', '2026-11-25']);
  });
  it('mensual salta los meses sin ese día (como Graph)', () => {
    expect(expandirFechas('2027-01-31', { tipo: 'mensual', hasta: '2027-05-31' })).toEqual([
      '2027-01-31',
      '2027-03-31',
      '2027-05-31',
    ]);
  });
  it('anual dentro del año: solo la primera', () => {
    expect(expandirFechas('2026-11-20', { tipo: 'anual', hasta: '2027-11-19' })).toEqual(['2026-11-20']);
  });
  it('días específicos: ordenados, sin repetidos e incluye la fecha de inicio', () => {
    expect(
      expandirFechas('2026-11-20', { tipo: 'especificos', fechas: ['2026-12-01', '2026-11-25', '2026-12-01'] })
    ).toEqual(['2026-11-20', '2026-11-25', '2026-12-01']);
  });
  it('tope de 1 año desde la primera fecha', () => {
    expect(expandirFechas('2026-11-20', { tipo: 'diaria', hasta: '2027-11-19' })).toHaveLength(365);
    const e = atrapar(() => expandirFechas('2026-11-20', { tipo: 'diaria', hasta: '2027-11-20' }));
    expect(e.message).toMatch(/1 año.*2027-11-19/);
    expect(() =>
      expandirFechas('2026-11-20', { tipo: 'especificos', fechas: ['2027-12-01'] })
    ).toThrow(/1 año/);
  });
  it('exige la fecha final y que sea posterior', () => {
    expect(() => expandirFechas('2026-11-20', { tipo: 'semanal' })).toThrow(/hasta qué fecha/);
    expect(() => expandirFechas('2026-11-20', { tipo: 'semanal', hasta: '2026-11-01' })).toThrow(/posterior/);
  });
  it('patrón de Graph', () => {
    expect(patronGraph('2026-11-20', { tipo: 'diaria', soloHabiles: true })).toMatchObject({
      type: 'weekly',
      daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    });
    expect(patronGraph('2026-11-20', { tipo: 'anual' })).toEqual({
      type: 'absoluteYearly',
      interval: 1,
      dayOfMonth: 20,
      month: 11,
    });
    expect(patronGraph('2026-11-20', { tipo: 'especificos' })).toBeNull();
  });
});

describe('ventana de reserva', () => {
  it('error claro con la fecha máxima permitida', () => {
    const e = atrapar(() => validarVentana(['2026-11-20', '2026-11-28'], '2026-11-17', 10, 'Quiet Room'));
    expect(e.message).toContain('2026-11-27');
    expect(e.detalle).toMatchObject({ codigo: 'VENTANA', fechaMaxima: '2026-11-27' });
  });
  it('dentro de la ventana no lanza', () => {
    expect(() => validarVentana(['2026-12-02'], '2026-11-17', 15, 'Sala')).not.toThrow();
  });
  it('no se reserva en el pasado', () => {
    const ocs = ocurrencias(['2026-11-17'], '08:00', '09:00');
    expect(() => validarNoPasado(ocs, msBogota('2026-11-17', '08:30'))).toThrow(/ya pasó/);
    expect(() => validarNoPasado(ocs, msBogota('2026-11-17', '07:59'))).not.toThrow();
  });
});

describe('choques', () => {
  const existente: EventoExistente = {
    inicioMs: msBogota('2026-11-20', '09:30'),
    finMs: msBogota('2026-11-20', '10:30'),
    asunto: 'Ocupado',
    fecha: '2026-11-20',
    horaInicio: '09:30',
    horaFin: '10:30',
  };
  it('detecta el cruce y devuelve el detalle', () => {
    const ocs = ocurrencias(['2026-11-19', '2026-11-20'], '09:00', '10:00');
    expect(detectarChoques(ocs, [existente])).toEqual([
      { fecha: '2026-11-20', asunto: 'Ocupado', horaInicio: '09:30', horaFin: '10:30' },
    ]);
  });
  it('reuniones contiguas no chocan', () => {
    const ocs = ocurrencias(['2026-11-20'], '10:30', '11:00');
    expect(detectarChoques(ocs, [existente])).toEqual([]);
  });
});

describe('SALAS_SOLO_LECTURA', () => {
  it('interpreta la variable', () => {
    expect(esSoloLectura('1')).toBe(true);
    expect(esSoloLectura('true')).toBe(true);
    expect(esSoloLectura('0')).toBe(false);
    expect(esSoloLectura(undefined)).toBe(false);
  });
  it('bloquea la escritura con 423 y el mensaje claro', () => {
    const e = atrapar(() => exigirEscritura(true, MENSAJE_SOLO_LECTURA));
    expect(e.status).toBe(423);
    expect(e.message).toMatch(/Modo de solo lectura/);
    expect(() => exigirEscritura(false, MENSAJE_SOLO_LECTURA)).not.toThrow();
  });
});
