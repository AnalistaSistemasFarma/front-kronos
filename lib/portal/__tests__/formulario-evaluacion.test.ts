import { describe, expect, it } from 'vitest';
import {
  calificar,
  definicionPublica,
  esEvaluacion,
  puntosTotales,
  validarDefinicion,
  validarRespuestas,
  type DefinicionFormulario,
} from '../formulario';

// Formularios tipo EVALUACIÓN (Cristian Baldión, 2026-10-09): enunciado, datos de
// la persona, preguntas con respuesta correcta y puntos que suman 100.

function evaluacion(over: Record<string, unknown> = {}, preguntas?: unknown[]) {
  return {
    formato: 1,
    codigo: 'EVA-TEST',
    titulo: 'Evaluación de prueba',
    tipo: 'evaluacion',
    notaMinima: 80,
    preguntas: preguntas ?? [
      { id: 'nombre', texto: 'Nombre completo', tipo: 'texto', obligatoria: true, prellenar: 'nombre' },
      { id: 'cedula', texto: 'Número de cédula', tipo: 'texto', obligatoria: true },
      { id: 'q1', texto: 'Uno', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b', 'c'], puntos: 60, correcta: 1 },
      { id: 'q2', texto: 'Dos', tipo: 'seleccion', obligatoria: true, opciones: ['x', 'y'], puntos: 40, correcta: 0 },
    ],
    ...over,
  };
}

function valida(crudo: unknown): DefinicionFormulario {
  const r = validarDefinicion(crudo);
  if (!r.ok) throw new Error(r.errores.join(' | '));
  return r.definicion;
}
function errores(crudo: unknown): string[] {
  const r = validarDefinicion(crudo);
  return r.ok ? [] : r.errores;
}

describe('validarDefinicion: evaluación', () => {
  it('acepta una evaluación completa y conserva puntos, correcta y nota mínima', () => {
    const d = valida(evaluacion());
    expect(esEvaluacion(d)).toBe(true);
    expect(d.notaMinima).toBe(80);
    expect(d.preguntas[2]).toMatchObject({ puntos: 60, correcta: 1, obligatoria: true });
    expect(puntosTotales(d)).toBe(100);
    // Las preguntas de datos no puntúan.
    expect(d.preguntas[0].puntos).toBeUndefined();
  });

  it('la nota mínima por defecto es 80', () => {
    const { notaMinima: _omitida, ...sin } = evaluacion();
    expect(valida(sin).notaMinima).toBe(80);
  });

  it('exige que los puntos sumen exactamente 100', () => {
    const e = errores(evaluacion({}, [{ id: 'q1', texto: 'Uno', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b'], puntos: 90, correcta: 0 }]));
    expect(e.join(' ')).toMatch(/sumar exactamente 100 \(hoy suman 90\)/);
  });

  it('acepta repartos con decimales que cierran en 100 (3 preguntas)', () => {
    const q = (id: string, puntos: number) => ({ id, texto: id, tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b'], puntos, correcta: 0 });
    expect(errores(evaluacion({}, [q('a', 33.33), q('b', 33.33), q('c', 33.34)]))).toEqual([]);
    expect(errores(evaluacion({}, [q('a', 33.33), q('b', 33.33), q('c', 33.33)])).join(' ')).toMatch(/hoy suman 99\.99/);
  });

  it('exige marcar la respuesta correcta de cada pregunta con puntos', () => {
    const e = errores(evaluacion({}, [{ id: 'q1', texto: 'Uno', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b'], puntos: 100 }]));
    expect(e.join(' ')).toMatch(/marque cuál es la respuesta correcta/);
  });

  it('rechaza una correcta fuera de las opciones, puntos inválidos y preguntas no calificables', () => {
    const base = { id: 'q1', texto: 'Uno', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b'] };
    expect(errores(evaluacion({}, [{ ...base, puntos: 100, correcta: 2 }])).join(' ')).toMatch(/"correcta" no corresponde/);
    expect(errores(evaluacion({}, [{ ...base, puntos: 0, correcta: 0 }])).join(' ')).toMatch(/mayor que 0/);
    expect(errores(evaluacion({}, [{ ...base, puntos: -5, correcta: 0 }])).join(' ')).toMatch(/mayor que 0/);
    expect(errores(evaluacion({}, [{ ...base, puntos: 10.123, correcta: 0 }])).join(' ')).toMatch(/2 decimales/);
    expect(errores(evaluacion({}, [{ ...base, puntos: 100, correcta: 0, permiteOtra: true }])).join(' ')).toMatch(/sin "otra respuesta"/);
    expect(errores(evaluacion({}, [{ id: 'q1', texto: 'Uno', tipo: 'texto', obligatoria: true, puntos: 100 }])).join(' ')).toMatch(/selección única/);
    expect(errores(evaluacion({}, [{ ...base, opciones: ['solo'], puntos: 100, correcta: 0 }])).join(' ')).toMatch(/al menos 2 opciones/);
    expect(errores(evaluacion({}, [{ ...base, correcta: 0 }])).join(' ')).toMatch(/tiene "correcta" pero no "puntos"/);
  });

  it('una opción puede ser un párrafo de hasta 500 caracteres', () => {
    const q = (largo: number) => [{ id: 'q1', texto: 'Uno', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'x'.repeat(largo)], puntos: 100, correcta: 1 }];
    expect(errores(evaluacion({}, q(500)))).toEqual([]);
    expect(errores(evaluacion({}, q(501))).join(' ')).toMatch(/opciones/);
  });

  it('una pregunta calificada queda obligatoria aunque se declare opcional', () => {
    const d = valida(evaluacion({}, [{ id: 'q1', texto: 'Uno', tipo: 'seleccion', obligatoria: false, opciones: ['a', 'b'], puntos: 100, correcta: 1 }]));
    expect(d.preguntas[0].obligatoria).toBe(true);
  });

  it('valida la nota mínima', () => {
    expect(errores(evaluacion({ notaMinima: 0 })).join(' ')).toMatch(/entre 1 y 100/);
    expect(errores(evaluacion({ notaMinima: 101 })).join(' ')).toMatch(/entre 1 y 100/);
    expect(errores(evaluacion({ notaMinima: 'alta' })).join(' ')).toMatch(/entre 1 y 100/);
    expect(valida(evaluacion({ notaMinima: 70.5 })).notaMinima).toBe(70.5);
  });

  it('un borrador puede estar incompleto (sin correctas ni suma de 100)', () => {
    const d = valida(
      evaluacion({ borrador: true }, [
        { id: 'q1', texto: 'Uno', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b'], puntos: 10, correcta: 1 },
        { id: 'q2', texto: 'Dos', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b'], puntos: 10 },
      ])
    );
    expect(d.borrador).toBe(true);
    expect(d.preguntas[1].correcta).toBeUndefined();
  });

  it('una encuesta no admite puntos, correcta, nota mínima ni borrador', () => {
    const encuesta = (extra: Record<string, unknown>, p: Record<string, unknown> = {}) => ({
      formato: 1,
      codigo: 'ENC',
      titulo: 'Encuesta',
      ...extra,
      preguntas: [{ id: 'q1', texto: 'Uno', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b'], ...p }],
    });
    expect(errores(encuesta({}, { puntos: 5 })).join(' ')).toMatch(/solo para evaluaciones/);
    expect(errores(encuesta({}, { correcta: 0 })).join(' ')).toMatch(/solo para evaluaciones/);
    expect(errores(encuesta({ notaMinima: 80 })).join(' ')).toMatch(/solo para evaluaciones/);
    expect(errores(encuesta({ borrador: true })).join(' ')).toMatch(/Solo una evaluación/);
    expect(errores(encuesta({ tipo: 'examen' })).join(' ')).toMatch(/"tipo" debe ser/);
    // Una encuesta normal sigue igual: sin "tipo" en la definición normalizada.
    const d = valida(encuesta({}));
    expect(d.tipo).toBeUndefined();
    expect(esEvaluacion(d)).toBe(false);
  });
});

describe('calificar', () => {
  const d = valida(evaluacion());
  const bien = { nombre: 'Ana', cedula: '123', q1: 'b', q2: 'x' };

  it('todas correctas = 100 % y aprobado', () => {
    expect(calificar(d, bien)).toMatchObject({ puntaje: 100, puntajeMax: 100, porcentaje: 100, aprobado: true, correctas: 2, calificadas: 2 });
  });

  it('una incorrecta resta sus puntos y compara contra la nota mínima', () => {
    expect(calificar(d, { ...bien, q2: 'y' })).toMatchObject({ puntaje: 60, porcentaje: 60, aprobado: false, correctas: 1 });
    expect(calificar(d, { ...bien, q1: 'a' })).toMatchObject({ puntaje: 40, porcentaje: 40, aprobado: false });
  });

  it('exactamente la nota mínima aprueba', () => {
    const q = (id: string) => ({ id, texto: id, tipo: 'seleccion', obligatoria: true, opciones: ['ok', 'mal'], puntos: 10, correcta: 0 });
    const diez = valida(evaluacion({}, Array.from({ length: 10 }, (_, i) => q('p' + i))));
    const r = (malas: number) =>
      Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['p' + i, i < malas ? 'mal' : 'ok']));
    expect(calificar(diez, r(2))).toMatchObject({ porcentaje: 80, aprobado: true });
    expect(calificar(diez, r(3))).toMatchObject({ porcentaje: 70, aprobado: false });
  });

  it('los datos de la persona (sin puntos) no puntúan', () => {
    expect(calificar(d, { q1: 'b', q2: 'x' }).puntaje).toBe(100);
  });

  it('una respuesta con "otra" no suma', () => {
    expect(calificar(d, { ...bien, q1: { otra: 'b' } }).puntaje).toBe(40);
  });
});

describe('definicionPublica', () => {
  it('quita las respuestas correctas y deja todo lo demás', () => {
    const d = valida(evaluacion());
    const publica = definicionPublica(d);
    expect(JSON.stringify(publica)).not.toContain('correcta');
    expect(publica.preguntas[2]).toMatchObject({ id: 'q1', puntos: 60, opciones: ['a', 'b', 'c'] });
    expect(publica.notaMinima).toBe(80);
    // No modifica la original.
    expect(d.preguntas[2].correcta).toBe(1);
  });
});

describe('validarRespuestas de una evaluación', () => {
  const d = valida(evaluacion());
  it('exige las calificadas y los datos obligatorios', () => {
    const r = validarRespuestas(d, { nombre: 'Ana' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.map((e) => e.id)).toEqual(['cedula', 'q1', 'q2']);
  });
  it('rechaza una opción que no existe', () => {
    const r = validarRespuestas(d, { nombre: 'Ana', cedula: '1', q1: 'zzz', q2: 'x' });
    expect(r.ok).toBe(false);
  });
});
