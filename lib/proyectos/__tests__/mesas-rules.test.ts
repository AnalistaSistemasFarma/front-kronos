import { describe, expect, it } from 'vitest';
import {
  ADVERTENCIA_ARCHIVOS,
  archivosDesdeUltimaSintesis,
  archivosParaAgente,
  detalleArchivoCompartido,
  esParticipanteMesa,
  MAX_ARCHIVOS_POR_TURNO,
  type ArchivoMesa,
  decidirTick,
  decidirTrasRespuesta,
  dentroDeHorario,
  diaCOT,
  esSinAporte,
  textoVisibleSinAporte,
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
    // «Todos los que quiera»: 12 agentes es válido.
    const doce = Array.from({ length: 12 }, (_, i) => ({ idAgent: i + 1 }));
    expect(validarMesa({ ...base, participantes: doce }, doce.map((d) => d.idAgent)).ok).toBe(true);
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

  it('las instrucciones piden una conversación natural, sin plantillas ni presentarse', () => {
    const t = instruccionesTurno({
      tema: 'Demoras de Tesorería',
      turno: { idAgent: 2, ronda: 2, turnoIdx: 1, esSintesis: false, rol: 'critica' },
      participantes: [{ nombre: 'Orus', rol: 'propone' }, { nombre: 'Mechita', rol: 'critica' }],
    });
    expect(t).toContain('Demoras de Tesorería');
    expect(t).toContain('conversación natural');
    expect(t).toContain('No se presente');
    expect(t).not.toContain('En pocas palabras');
    expect(t).toContain('nada de correos');
    expect(t).toContain(MARCA_SIN_APORTE);
  });

  it('la síntesis es un cierre en prosa, sin secciones', () => {
    const t = instruccionesTurno({
      tema: 'x',
      turno: { idAgent: 1, ronda: 3, turnoIdx: 2, esSintesis: true, rol: 'moderador: síntesis' },
      participantes: [],
    });
    expect(t).toContain('en qué quedaron');
    expect(t).toContain('Sin títulos ni secciones');
  });

  it('sin aporte: en el hilo queda una frase natural, sin la marca', () => {
    expect(textoVisibleSinAporte('[SIN APORTE] estoy de acuerdo con Orus')).toBe(
      'Por mi parte no tengo nada nuevo que agregar por ahora. Estoy de acuerdo con Orus',
    );
    expect(textoVisibleSinAporte('[SIN APORTE]')).toBe('Por mi parte no tengo nada nuevo que agregar por ahora.');
  });

  it('resumenParaOperador toma la primera frase (y quita la etiqueta vieja si viene)', () => {
    expect(resumenParaOperador('Estoy de acuerdo con Zoe. Pero falta el costo.')).toBe('Estoy de acuerdo con Zoe.');
    expect(resumenParaOperador('**En pocas palabras:** hay que mostrar un caso real. Detalle…')).toBe('hay que mostrar un caso real.');
    expect(resumenParaOperador('[SIN APORTE] de acuerdo')).toBe('Por mi parte no tengo nada nuevo que agregar por ahora. De acuerdo');
    expect(resumenParaOperador('a'.repeat(400)).length).toBe(280);
  });

});

describe('mesas: archivos compartidos (2026-11-11)', () => {
  // Mesa: Orus (1, modera), Mechita (2), Duo (3). El 9 es un agente de afuera.
  const mesa = { participantes: [1, 2, 3], idAgentModerador: 1 };
  const archivo = (id: number, idAgent: number, ronda: number | null, agente = `A${idAgent}`): ArchivoMesa => ({
    idAttachment: id,
    nombre: `archivo-${id}.csv`,
    idAgent,
    agente,
    ronda,
  });

  it('solo los agentes de la mesa reciben los archivos', () => {
    const archivos = [archivo(10, 2, 1), archivo(11, 3, 2)];
    expect(esParticipanteMesa(mesa, 2)).toBe(true);
    expect(esParticipanteMesa({ participantes: [2, 3], idAgentModerador: 1 }, 1)).toBe(true);
    expect(esParticipanteMesa(mesa, 9)).toBe(false);
    expect(archivosParaAgente({ archivos, ...mesa, idAgent: 3 }).map((a) => a.idAttachment)).toEqual([10, 11]);
    expect(archivosParaAgente({ archivos, ...mesa, idAgent: 9 })).toEqual([]);
  });

  it('no reparte archivos que publicó un agente de afuera de la mesa', () => {
    const archivos = [archivo(10, 2, 1), archivo(12, 9, 1)];
    expect(archivosParaAgente({ archivos, ...mesa, idAgent: 1 }).map((a) => a.idAttachment)).toEqual([10]);
  });

  it('entrega solo los más recientes, hasta el tope por turno', () => {
    const muchos = Array.from({ length: MAX_ARCHIVOS_POR_TURNO + 3 }, (_, i) => archivo(i + 1, 2, 1));
    const r = archivosParaAgente({ archivos: muchos, ...mesa, idAgent: 3 });
    expect(r).toHaveLength(MAX_ARCHIVOS_POR_TURNO);
    expect(r[0].idAttachment).toBe(4);
    expect(r.at(-1)?.idAttachment).toBe(MAX_ARCHIVOS_POR_TURNO + 3);
  });

  it('instrucciones con archivos: qué hay, quién lo compartió, en qué ronda, y la advertencia', () => {
    const t = instruccionesTurno({
      tema: 'Demoras de Tesorería',
      turno: { idAgent: 3, ronda: 2, turnoIdx: 2, esSintesis: false, rol: 'verifica datos' },
      participantes: [{ nombre: 'Orus', rol: 'propone' }, { nombre: 'Mechita', rol: 'critica' }],
      archivos: [{ idAttachment: 10, nombre: 'pagos-octubre.csv', idAgent: 2, agente: 'Mechita', ronda: 1 }],
    });
    expect(t).toContain('Archivos de la mesa');
    expect(t).toContain('«pagos-octubre.csv» (lo compartió Mechita en la ronda 1)');
    expect(t).toContain('Puede abrirlos, leerlos y citarlos');
    expect(t).toContain('adjúntelo a su intervención');
    expect(t).toContain(ADVERTENCIA_ARCHIVOS);
  });

  it('instrucciones sin archivos: lo dice, y aun así explica cómo compartir y advierte', () => {
    const t = instruccionesTurno({
      tema: 'x',
      turno: { idAgent: 2, ronda: 1, turnoIdx: 0, esSintesis: false, rol: 'propone' },
      participantes: [],
    });
    expect(t).toContain('nadie ha compartido archivos');
    expect(t).toContain('adjúntelo a su intervención');
    expect(t).toContain('No comparta contraseñas, llaves ni datos personales sensibles');
  });

  it('síntesis: exige la línea «Archivos compartidos:» con los de las rondas desde la síntesis anterior', () => {
    const archivos = [archivo(10, 2, 2, 'Mechita'), archivo(11, 3, 4, 'Duo'), archivo(12, 2, 6, 'Mechita')];
    expect(archivosDesdeUltimaSintesis(archivos, 6, 3).map((a) => a.idAttachment)).toEqual([11, 12]);
    const t = instruccionesTurno({
      tema: 'x',
      turno: { idAgent: 1, ronda: 6, turnoIdx: 3, esSintesis: true, rol: 'moderador: síntesis' },
      participantes: [],
      archivos,
      sintesisCada: 3,
    });
    expect(t).toContain('«Archivos compartidos:»');
    expect(t).toContain('quién lo compartió y para qué sirve');
    expect(t).toContain('«archivo-11.csv» (lo compartió Duo en la ronda 4)');
    expect(t).toContain('«archivo-12.csv» (lo compartió Mechita en la ronda 6)');
    // El de la ronda 2 ya lo informó la síntesis de la ronda 3: no se exige otra vez en esa línea.
    const lineaSintesis = t.split('\n').filter((l) => l.startsWith('- «archivo-10'));
    expect(lineaSintesis).toEqual([]);
  });

  it('síntesis sin archivos nuevos: la línea dice que nadie compartió', () => {
    const t = instruccionesTurno({
      tema: 'x',
      turno: { idAgent: 1, ronda: 3, turnoIdx: 2, esSintesis: true, rol: 'moderador: síntesis' },
      participantes: [],
      archivos: [],
    });
    expect(t).toContain('nadie compartió archivos');
  });

  it('detalle del evento archivo_compartido: nombre, agente y ronda, dentro del tope', () => {
    expect(detalleArchivoCompartido('pagos.csv', 'Mechita', 2)).toBe('Mechita compartió «pagos.csv» en la ronda 2.');
    expect(detalleArchivoCompartido('x'.repeat(2000), 'Mechita', 2).length).toBeLessThanOrEqual(1000);
  });
});
