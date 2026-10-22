import { describe, expect, it } from 'vitest';
import {
  calidadRespuesta,
  cambiosGobierno,
  duracionLegible,
  EntradaInvalidaError,
  entregasConProblema,
  eventosRuntime,
  extraerRuntimes,
  parseRuntime,
  validarEstadoHallazgo,
  validarGobierno,
  validarHallazgoExterno,
  validarVinculoCaso,
  type InventoryRuntime,
} from '../cv-completa';

const base: InventoryRuntime = {
  authMode: 'token',
  authDetail: null,
  tokenFingerprint: '51de66cc7ed6',
  processStartedAt: new Date('2026-10-20T06:00:02.000Z'),
  lastRotationAt: null,
  lastRotationStatus: null,
  lastRotationDetail: null,
  personaFingerprint: 'aaaaaaaaaaaa',
  personaFiles: ['CLAUDE.md'],
  governance: [],
  usageHook: true,
};
const AT = new Date('2026-10-20T07:30:00.000Z');

describe('parseRuntime: lo que manda el recolector', () => {
  it('acepta huellas de 12 hex y rechaza cualquier otra cosa (nunca el valor de la credencial)', () => {
    expect(parseRuntime({ authMode: 'token', tokenFingerprint: '51DE66CC7ED6' })?.tokenFingerprint).toBe('51de66cc7ed6');
    expect(parseRuntime({ authMode: 'token', tokenFingerprint: 'sk-ant-oat01-abcdefghijklmnop' })?.tokenFingerprint).toBeNull();
    expect(parseRuntime({ authMode: 'token', tokenFingerprint: 'a'.repeat(64) })?.tokenFingerprint).toBeNull();
  });

  it('modo desconocido si no es uno de los permitidos', () => {
    expect(parseRuntime({ authMode: 'contraseña' })?.authMode).toBe('desconocido');
  });

  it('sin objeto runtime devuelve null (recolector viejo)', () => {
    expect(parseRuntime(undefined)).toBeNull();
    expect(parseRuntime([])).toBeNull();
  });

  it('el texto de los bloques de gobierno pasa por el filtro de secretos', () => {
    const rt = parseRuntime({
      governance: [
        { marker: 'GOBIERNO-IA-MINPRIV', addedOn: '2026-10-19', author: 'horus', caseRef: 6212, text: 'No lea llaves. Bearer abc.def.ghi y sk-ant-api03-XXXXXXXXXXXXXXXX', file: 'AGENTS.md' },
        { marker: 'OTRA-COSA', text: 'x' },
      ],
    });
    expect(rt?.governance).toHaveLength(1);
    expect(rt?.governance[0].text).not.toContain('sk-ant');
    expect(rt?.governance[0].text).toContain('<oculto>');
    expect(rt?.governance[0].caseRef).toBe(6212);
  });

  it('descarta fechas imposibles (reloj roto)', () => {
    expect(parseRuntime({ processStartedAt: '1999-01-01T00:00:00Z' })?.processStartedAt).toBeNull();
    expect(parseRuntime({ processStartedAt: '2026-10-20T06:00:02+00:00' })?.processStartedAt?.toISOString()).toBe('2026-10-20T06:00:02.000Z');
  });

  it('extraerRuntimes toma el runtime de cada agente por código', () => {
    const m = extraerRuntimes({ agents: [{ code: 'Horus', runtime: { authMode: 'token' } }, { code: 'mark' }] });
    expect([...m.keys()]).toEqual(['horus']);
  });
});

describe('eventosRuntime: línea de tiempo a partir de los datos de ejecución', () => {
  it('primer inventario: registra el arranque, pero no "cambios" de credencial', () => {
    const ev = eventosRuntime(null, base, AT);
    expect(ev.map((e) => e.kind)).toEqual(['reinicio']);
    expect(ev[0].title).toBe('Arranque del agente en ejecución');
  });

  it('el mismo arranque visto en otro escaneo (segundos de diferencia) no se repite', () => {
    const otro = { ...base, processStartedAt: new Date('2026-10-20T06:01:00.000Z') };
    expect(eventosRuntime(base, otro, AT)).toEqual([]);
  });

  it('un arranque nuevo es un reinicio', () => {
    const otro = { ...base, processStartedAt: new Date('2026-10-20T09:00:00.000Z') };
    const ev = eventosRuntime(base, otro, AT);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'reinicio', title: 'Se reinició el agente' });
  });

  it('cambio de credencial: solo huellas en el detalle', () => {
    const ev = eventosRuntime(base, { ...base, tokenFingerprint: '536a7da5951c' }, AT);
    const c = ev.find((e) => e.kind === 'credencial')!;
    expect(c.detail).toContain('huella 51de66cc7ed6');
    expect(c.detail).toContain('huella 536a7da5951c');
    expect(c.occurredAt).toBe(AT);
  });

  it('cambio de personalidad', () => {
    const ev = eventosRuntime(base, { ...base, personaFingerprint: 'bbbbbbbbbbbb' }, AT);
    expect(ev.find((e) => e.kind === 'personalidad')?.sourceRef).toBe('persona:aaaaaaaaaaaa>bbbbbbbbbbbb');
  });

  it('rotación y bloque de gobierno con su fecha propia', () => {
    const ev = eventosRuntime(
      null,
      {
        ...base,
        processStartedAt: null,
        lastRotationAt: new Date('2026-10-19T21:37:48.000Z'),
        lastRotationStatus: 'ok',
        lastRotationDetail: 'sesión 113.7 MB → 0.0 MB',
        governance: [{ marker: 'GOBIERNO-IA-MINPRIV', addedOn: '2026-10-19', author: 'horus', caseRef: 6212, text: 'x', file: 'AGENTS.md' }],
      },
      AT
    );
    expect(ev.map((e) => e.kind)).toEqual(['rotacion', 'gobierno']);
    expect(ev[0].sourceRef).toBe('rotacion:2026-10-19');
    expect(ev[1].title).toContain('caso #6212');
    expect(ev[1].occurredAt.toISOString().slice(0, 10)).toBe('2026-10-19');
  });
});

describe('calidad de respuesta (solo horas, nunca texto)', () => {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 20, 12, 0) + min * 60_000);
  const ahora = t(600);

  it('mediana, percentil 90 y preguntas sin respuesta', () => {
    const q = calidadRespuesta(
      [
        { at: t(0), respondidaAt: t(1) }, // 60 s
        { at: t(10), respondidaAt: t(12) }, // 120 s
        { at: t(20), respondidaAt: t(25) }, // 300 s
        { at: t(30), respondidaAt: t(120) }, // 90 min: tarde
        { at: t(200), respondidaAt: null }, // sin respuesta
        { at: t(590), respondidaAt: null }, // en espera (dentro de la hora)
      ],
      ahora
    );
    expect(q).toMatchObject({ preguntas: 6, respondidas: 4, sinRespuesta: 2, enEspera: 1, medianaSeg: 120, p90Seg: 5400 });
  });

  it('sin preguntas no hay tiempos', () => {
    expect(calidadRespuesta([], ahora)).toMatchObject({ preguntas: 0, medianaSeg: null, p90Seg: null });
  });

  it('entregas tardías y pendientes', () => {
    expect(
      entregasConProblema(
        [
          { creadoAt: t(0), entregadoAt: t(1) },
          { creadoAt: t(0), entregadoAt: t(30) },
          { creadoAt: t(0), entregadoAt: null },
          { creadoAt: t(595), entregadoAt: null },
        ],
        ahora
      )
    ).toEqual({ tardias: 1, pendientes: 1 });
  });

  it('duración legible', () => {
    expect(duracionLegible(null)).toBe('—');
    expect(duracionLegible(45)).toBe('45 s');
    expect(duracionLegible(180)).toBe('3 min');
    expect(duracionLegible(4800)).toBe('1 h 20 min');
  });
});

describe('ediciones con el permiso de configurar', () => {
  it('gobierno: valida correo y fecha, y describe los cambios', () => {
    expect(() => validarGobierno({ directorEmail: 'no-es-correo' })).toThrow(EntradaInvalidaError);
    expect(() => validarGobierno({ privilegeAppliedOn: '19/10/2026' })).toThrow(EntradaInvalidaError);
    const g = validarGobierno({ directorName: ' Andrea  Duque ', directorEmail: 'Andrea.Duque@OLP.com', privilegeTemplate: 'Plantilla A — sin SAP', privilegeAppliedOn: '2026-10-19' });
    expect(g.directorName).toBe('Andrea Duque');
    expect(g.directorEmail).toBe('andrea.duque@olp.com');
    expect(cambiosGobierno(null, g)).toEqual([
      'Director: Andrea Duque · andrea.duque@olp.com.',
      'Mínimo privilegio: Plantilla A — sin SAP (aplicado el 2026-10-19).',
    ]);
    expect(cambiosGobierno(g, g)).toEqual([]);
  });

  it('vínculo de caso: número y relación', () => {
    expect(validarVinculoCaso({ idRequest: '#6212', relation: 'gobierno-ia' })).toEqual({ idRequest: 6212, relation: 'gobierno-ia' });
    expect(() => validarVinculoCaso({ idRequest: 'abc', relation: 'gobierno-ia' })).toThrow(EntradaInvalidaError);
    expect(() => validarVinculoCaso({ idRequest: 1, relation: 'cualquiera' })).toThrow(EntradaInvalidaError);
  });

  it('hallazgo de Gobierno IA: obligatorios y normalización', () => {
    const h = validarHallazgoExterno({ refCode: 'h-01', severity: 'alto', title: 'Ejecuta comandos sin aprobación', reportedOn: '2026-10-20', idRequest: '#6212' });
    expect(h).toMatchObject({ refCode: 'H-01', source: 'Gobierno IA (Iván Gutiérrez)', idRequest: 6212 });
    expect(() => validarHallazgoExterno({ refCode: 'H 01', severity: 'alto', title: 'x', reportedOn: '2026-10-20' })).toThrow(EntradaInvalidaError);
    expect(() => validarHallazgoExterno({ refCode: 'H-01', severity: 'grave', title: 'x', reportedOn: '2026-10-20' })).toThrow(EntradaInvalidaError);
    expect(() => validarHallazgoExterno({ refCode: 'H-01', severity: 'alto', title: 'x' })).toThrow(EntradaInvalidaError);
    expect(validarEstadoHallazgo({ status: 'aceptado' })).toEqual({ status: 'aceptado' });
    expect(() => validarEstadoHallazgo({ status: 'borrado' })).toThrow(EntradaInvalidaError);
  });
});
