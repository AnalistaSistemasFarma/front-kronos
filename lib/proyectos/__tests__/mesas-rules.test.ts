import { describe, expect, it } from 'vitest';
import {
  decidirTick,
  decidirTrasRespuesta,
  dentroDeHorario,
  diaCOT,
  esSinAporte,
  ETIQUETA_RESUMEN,
  instruccionesTurno,
  resumenParaOperador,
  MARCA_SIN_APORTE,
  MESA_TURNO_VENCE_MS,
  normalizarReglasMesa,
  siguienteEnHorario,
  textoAvisoTurno,
  validarMesa,
  type EstadoMotor,
  type ReglasMesa,
} from '../mesas-rules';

/*
 * Mesas de discusión de Proyectos (2026-11-04). Reglas PURAS (lib/proyectos/mesas-rules.ts).
 * Las horas van en UTC: COT = UTC-5 (las 10:00 COT son las 15:00Z).
 */

const reglas = (over: Partial<ReglasMesa> = {}): ReglasMesa => {
  const r = normalizarReglasMesa({});
  if (!r.ok) throw new Error(r.error);
  return { ...r.value, ...over };
};

// Miércoles 2026-11-04, 10:00 COT.
const MIE_10 = new Date('2026-11-04T15:00:00Z');

const mesa = (over: Partial<EstadoMotor> = {}): EstadoMotor => ({
  estado: 'activa',
  reglas: reglas(),
  participantes: [
    { idAgent: 1, rol: 'propone' },
    { idAgent: 2, rol: 'critica' },
    { idAgent: 3, rol: 'verifica datos' },
  ],
  idAgentModerador: 1,
  ronda: 0,
  turnoIdx: -1,
  turnoDesde: null,
  proximoTurnoAt: MIE_10,
  turnosHoy: 0,
  turnosDia: null,
  aportesRonda: 0,
  ...over,
});

describe('validarMesa', () => {
  const base = {
    tema: '¿Cómo bajamos las demoras de Tesorería?',
    participantes: [
      { idAgent: 1, rol: 'propone' },
      { idAgent: 2, rol: '' },
    ],
    idAgentModerador: 1,
  };

  it('acepta una mesa válida y completa las reglas por defecto', () => {
    const r = validarMesa(base, [1, 2, 3]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reglas).toEqual({
      ritmoMin: 30,
      topeDia: 40,
      sintesisCada: 3,
      horarioDesde: 420,
      horarioHasta: 1140,
      soloHabiles: true,
    });
    expect(r.value.participantes[1].rol).toBe('participa');
  });

  it('exige tema, al menos 2 agentes designados, sin repetir, y moderador participante', () => {
    expect(validarMesa({ ...base, tema: '  ' }, [1, 2]).ok).toBe(false);
    expect(validarMesa({ ...base, participantes: [{ idAgent: 1 }] }, [1, 2]).ok).toBe(false);
    expect(validarMesa({ ...base, participantes: [{ idAgent: 1 }, { idAgent: 1 }] }, [1, 2]).ok).toBe(false);
    expect(validarMesa(base, [1]).ok).toBe(false); // el 2 no está designado
    expect(validarMesa({ ...base, idAgentModerador: 3 }, [1, 2, 3]).ok).toBe(false);
  });

  it('rechaza reglas fuera de rango', () => {
    expect(validarMesa({ ...base, reglas: { ritmoMin: 5 } }, [1, 2]).ok).toBe(false);
    expect(validarMesa({ ...base, reglas: { topeDia: 0 } }, [1, 2]).ok).toBe(false);
    expect(validarMesa({ ...base, reglas: { horarioDesde: 600, horarioHasta: 600 } }, [1, 2]).ok).toBe(false);
  });
});

describe('horario (COT)', () => {
  it('10:00 COT de un miércoles está dentro; 20:00 no; un sábado tampoco', () => {
    expect(dentroDeHorario(MIE_10, reglas())).toBe(true);
    expect(dentroDeHorario(new Date('2026-11-05T01:00:00Z'), reglas())).toBe(false); // mié 20:00 COT
    expect(dentroDeHorario(new Date('2026-11-07T15:00:00Z'), reglas())).toBe(false); // sábado
    expect(dentroDeHorario(new Date('2026-11-07T15:00:00Z'), reglas({ soloHabiles: false }))).toBe(true);
  });

  it('fuera de horario, la siguiente ventana es a las 07:00 COT del próximo día hábil', () => {
    // Viernes 2026-11-06 20:00 COT → lunes 2026-11-09 07:00 COT (12:00Z).
    expect(siguienteEnHorario(new Date('2026-11-07T01:00:00Z'), reglas()).toISOString()).toBe('2026-11-09T12:00:00.000Z');
    // Miércoles 05:00 COT → mismo día 07:00 COT.
    expect(siguienteEnHorario(new Date('2026-11-04T10:00:00Z'), reglas()).toISOString()).toBe('2026-11-04T12:00:00.000Z');
  });

  it('el día del contador es el de Colombia, no el UTC', () => {
    expect(diaCOT(new Date('2026-11-05T03:00:00Z'))).toBe('2026-11-04'); // 22:00 COT del 4
  });
});

describe('decidirTick', () => {
  it('a la hora programada empieza la ronda 1 con el primer participante', () => {
    const d = decidirTick(mesa(), MIE_10);
    expect(d).toMatchObject({ tipo: 'entregar', turno: { idAgent: 1, ronda: 1, turnoIdx: 0, esSintesis: false } });
  });

  it('antes de la hora, pausada o cerrada: nada', () => {
    expect(decidirTick(mesa({ proximoTurnoAt: new Date(MIE_10.getTime() + 60_000) }), MIE_10).tipo).toBe('nada');
    expect(decidirTick(mesa({ estado: 'pausada' }), MIE_10).tipo).toBe('nada');
    expect(decidirTick(mesa({ estado: 'cerrada' }), MIE_10).tipo).toBe('nada');
  });

  it('«ronda ahora» la fuerza aunque no sea la hora ni el horario', () => {
    const noche = new Date('2026-11-05T02:00:00Z');
    const d = decidirTick(mesa({ proximoTurnoAt: null }), noche, { forzar: true });
    expect(d.tipo).toBe('entregar');
  });

  it('si es la hora pero fuera del horario, reprograma a la siguiente ventana', () => {
    const noche = new Date('2026-11-05T02:00:00Z'); // mié 21:00 COT
    const d = decidirTick(mesa({ proximoTurnoAt: noche }), noche);
    expect(d).toMatchObject({ tipo: 'programar' });
    if (d.tipo === 'programar') expect(d.at.toISOString()).toBe('2026-11-05T12:00:00.000Z');
  });

  it('un turno sin respuesta en 20 min se salta y pasa al siguiente', () => {
    const m = mesa({ ronda: 1, turnoIdx: 0, turnoDesde: MIE_10, proximoTurnoAt: null, aportesRonda: 0 });
    expect(decidirTick(m, new Date(MIE_10.getTime() + MESA_TURNO_VENCE_MS - 1)).tipo).toBe('nada');
    const d = decidirTick(m, new Date(MIE_10.getTime() + MESA_TURNO_VENCE_MS));
    expect(d).toMatchObject({ tipo: 'entregar', turno: { idAgent: 2, turnoIdx: 1 }, vencido: { idAgent: 1 } });
  });

  it('al llegar al tope del día no entrega: espera a la primera ventana de mañana', () => {
    const d = decidirTick(mesa({ turnosHoy: 40, turnosDia: '2026-11-04' }), MIE_10);
    expect(d).toMatchObject({ tipo: 'programar', porTope: true });
    if (d.tipo === 'programar') expect(d.at.toISOString()).toBe('2026-11-05T12:00:00.000Z');
  });

  it('el contador de ayer no cuenta para el tope de hoy', () => {
    expect(decidirTick(mesa({ turnosHoy: 40, turnosDia: '2026-11-03' }), MIE_10).tipo).toBe('entregar');
  });
});

describe('decidirTrasRespuesta', () => {
  const enTurno = (idx: number, over: Partial<EstadoMotor> = {}) =>
    mesa({ ronda: 1, turnoIdx: idx, turnoDesde: MIE_10, proximoTurnoAt: null, turnosHoy: idx + 1, turnosDia: '2026-11-04', ...over });

  it('pasa el turno al siguiente participante', () => {
    expect(decidirTrasRespuesta(enTurno(0), 1, true, MIE_10)).toMatchObject({ tipo: 'entregar', turno: { idAgent: 2, turnoIdx: 1 } });
  });

  it('quien publica fuera de su turno no mueve nada', () => {
    expect(decidirTrasRespuesta(enTurno(0), 2, true, MIE_10).tipo).toBe('nada');
    expect(decidirTrasRespuesta(mesa(), 1, true, MIE_10).tipo).toBe('nada');
  });

  it('al cerrar la ronda programa la siguiente según el ritmo', () => {
    const d = decidirTrasRespuesta(enTurno(2, { aportesRonda: 2 }), 3, true, MIE_10);
    expect(d).toMatchObject({ tipo: 'programar' });
    if (d.tipo === 'programar') expect(d.at.getTime()).toBe(MIE_10.getTime() + 30 * 60_000);
  });

  it('cada N rondas, al cerrar la ronda el moderador hace la síntesis', () => {
    const d = decidirTrasRespuesta(enTurno(2, { ronda: 3, aportesRonda: 1 }), 3, false, MIE_10);
    expect(d).toMatchObject({ tipo: 'entregar', turno: { idAgent: 1, turnoIdx: 3, esSintesis: true } });
    // Después de la síntesis, la ronda siguiente.
    const s = decidirTrasRespuesta(enTurno(3, { ronda: 3, aportesRonda: 1 }), 1, true, MIE_10);
    expect(s.tipo).toBe('programar');
  });

  it('una ronda completa sin aportes pausa la mesa', () => {
    expect(decidirTrasRespuesta(enTurno(2, { aportesRonda: 0 }), 3, false, MIE_10)).toEqual({ tipo: 'pausar', motivo: 'sin_aporte' });
  });

  it('el aporte del último participante cuenta para no pausar', () => {
    expect(decidirTrasRespuesta(enTurno(2, { aportesRonda: 0 }), 3, true, MIE_10).tipo).toBe('programar');
  });
});

describe('textos', () => {
  it('esSinAporte reconoce la marca', () => {
    expect(esSinAporte(`${MARCA_SIN_APORTE}`)).toBe(true);
    expect(esSinAporte(' [sin aporte] nada nuevo')).toBe(true);
    expect(esSinAporte('Propongo hacer en paralelo…')).toBe(false);
  });

  it('el aviso publicado es corto y entendible: sin reglas internas', () => {
    const t = textoAvisoTurno({
      turno: { idAgent: 2, ronda: 2, turnoIdx: 1, esSintesis: false, rol: 'criticar las propuestas' },
      handle: 'mechita',
      nombre: 'Mechita',
      totalParticipantes: 3,
    });
    expect(t).toBe('🗣️ **Ronda 2** · turno 2 de 3 · le toca a Mechita (@mechita) — su papel: criticar las propuestas.');
    expect(t).not.toContain('Instrucciones');
  });

  it('las instrucciones del agente exigen lenguaje para el operador y el resumen', () => {
    const t = instruccionesTurno({
      tema: 'Demoras de Tesorería',
      turno: { idAgent: 2, ronda: 2, turnoIdx: 1, esSintesis: false, rol: 'critica' },
      participantes: [{ nombre: 'Orus', rol: 'propone' }, { nombre: 'Mechita', rol: 'critica' }],
    });
    expect(t).toContain('Demoras de Tesorería');
    expect(t).toContain(ETIQUETA_RESUMEN);
    expect(t).toContain('NO es técnica');
    expect(t).toContain('nada de correos');
    expect(t).toContain(MARCA_SIN_APORTE);
  });

  it('la síntesis pide acuerdos, pendientes y lo que se necesita de las personas', () => {
    const t = instruccionesTurno({
      tema: 'x',
      turno: { idAgent: 1, ronda: 3, turnoIdx: 2, esSintesis: true, rol: 'moderador: síntesis' },
      participantes: [],
    });
    expect(t).toContain('En qué estamos de acuerdo');
    expect(t).toContain('Qué sigue abierto');
    expect(t).toContain('qué necesitamos de ustedes');
  });

  it('resumenParaOperador toma la línea «En pocas palabras» o, si falta, la primera frase', () => {
    expect(resumenParaOperador('**En pocas palabras:** las aprobaciones de Tesorería se pueden hacer a la vez.\n\nDetalle…')).toBe(
      'las aprobaciones de Tesorería se pueden hacer a la vez.',
    );
    expect(resumenParaOperador('Revisé octubre. Hubo 40 casos.')).toBe('Revisé octubre.');
    expect(resumenParaOperador('[SIN APORTE] estoy de acuerdo con Orus')).toBe('Sin aporte nuevo: estoy de acuerdo con Orus');
    expect(resumenParaOperador(`En pocas palabras: ${'a'.repeat(400)}`).length).toBe(280);
  });
});
