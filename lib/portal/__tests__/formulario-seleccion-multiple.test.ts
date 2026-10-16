import { describe, expect, it } from 'vitest';
import {
  calificar,
  definicionPublica,
  estaVacia,
  textoDeRespuesta,
  validarDefinicion,
  validarPregunta,
  validarRespuestas,
  type DefinicionFormulario,
  type PreguntaFormulario,
} from '../formulario';

// Selección múltiple y lista desplegable (Cristian Baldión, 2026-10-14).

const multiple = (extra: Record<string, unknown> = {}) => ({ id: 'm1', texto: 'Seleccione 3', tipo: 'seleccion_multiple', obligatoria: true, opciones: ['A', 'B', 'C', 'D'], ...extra });
const encuesta = (preguntas: unknown[]) => ({ formato: 1, codigo: 'ENC-M', titulo: 'Encuesta', preguntas });
const evaluacion = (preguntas: unknown[], extra: Record<string, unknown> = {}) => ({ formato: 1, codigo: 'EVA-M', titulo: 'Evaluación', tipo: 'evaluacion', notaMinima: 80, preguntas, ...extra });
const valida = (crudo: unknown): DefinicionFormulario => {
  const r = validarDefinicion(crudo);
  if (!r.ok) throw new Error(r.errores.join(' | '));
  return r.definicion;
};
const errores = (crudo: unknown): string => {
  const r = validarDefinicion(crudo);
  return r.ok ? '' : r.errores.join(' | ');
};

describe('definición: selección múltiple y lista', () => {
  it('acepta una selección múltiple en una encuesta', () => {
    const d = valida(encuesta([multiple()]));
    expect(d.preguntas[0]).toMatchObject({ tipo: 'seleccion_multiple', opciones: ['A', 'B', 'C', 'D'] });
    expect(d.preguntas[0].permiteOtra).toBeUndefined();
  });
  it('no admite "otra respuesta" ni lista desplegable en una selección múltiple', () => {
    expect(errores(encuesta([multiple({ permiteOtra: true })]))).toMatch(/no admite "otra respuesta"/);
    expect(errores(encuesta([multiple({ presentacion: 'lista' })]))).toMatch(/solo para la selección única/);
  });
  it('lista desplegable: es una selección única con presentacion "lista"', () => {
    const d = valida(encuesta([{ id: 'l1', texto: 'Elija', tipo: 'seleccion', obligatoria: true, opciones: ['x', 'y'], presentacion: 'lista' }]));
    expect(d.preguntas[0]).toMatchObject({ tipo: 'seleccion', presentacion: 'lista' });
    expect(errores(encuesta([{ id: 'l1', texto: 'Elija', tipo: 'seleccion', obligatoria: true, opciones: ['x'], presentacion: 'tabla' }]))).toMatch(/solo puede ser "lista"/);
    expect(errores(encuesta([{ id: 't1', texto: 'Texto', tipo: 'texto', obligatoria: true, presentacion: 'lista' }]))).toMatch(/solo para la selección única/);
  });
  it('una evaluación con selección múltiple exige "correctas" (lista) y las ordena', () => {
    const d = valida(evaluacion([multiple({ puntos: 100, correctas: [2, 0, 1] })]));
    expect(d.preguntas[0].correctas).toEqual([0, 1, 2]);
    expect(errores(evaluacion([multiple({ puntos: 100 })]))).toMatch(/marque cuál es la respuesta correcta/);
    expect(errores(evaluacion([multiple({ puntos: 100, correctas: [] })]))).toMatch(/"correctas" debe ser una lista/);
    expect(errores(evaluacion([multiple({ puntos: 100, correctas: [0, 0] })]))).toMatch(/"correctas" debe ser una lista/);
    expect(errores(evaluacion([multiple({ puntos: 100, correctas: [9] })]))).toMatch(/"correctas" debe ser una lista/);
    expect(errores(evaluacion([multiple({ puntos: 100, correcta: 1 })]))).toMatch(/usa "correctas"/);
  });
  it('"correctas" es solo de la múltiple; "correcta" solo de la única', () => {
    const unica = { id: 'u1', texto: 'Una', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b'], puntos: 100 };
    expect(errores(evaluacion([{ ...unica, correctas: [0] }]))).toMatch(/solo para la selección múltiple/);
    expect(valida(evaluacion([{ ...unica, correcta: 1 }])).preguntas[0].correcta).toBe(1);
    expect(errores(encuesta([multiple({ puntos: 5, correctas: [0] })]))).toMatch(/solo para evaluaciones/);
  });
  it('un borrador admite la múltiple sin correctas', () => {
    const d = valida(evaluacion([multiple({ puntos: 10 })], { borrador: true }));
    expect(d.preguntas[0].correctas).toBeUndefined();
  });
  it('definicionPublica quita "correctas" y "correcta"', () => {
    const d = valida(evaluacion([multiple({ puntos: 50, correctas: [0, 1] }), { id: 'u', texto: 'U', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b'], puntos: 50, correcta: 0 }]));
    expect(JSON.stringify(definicionPublica(d))).not.toMatch(/"correctas?":/);
    expect(d.preguntas[0].correctas).toEqual([0, 1]);
  });
});

describe('respuestas a una selección múltiple', () => {
  const p: PreguntaFormulario = { id: 'm1', texto: 'Seleccione', tipo: 'seleccion_multiple', obligatoria: true, opciones: ['A', 'B', 'C'] };
  it('lista vacía = sin responder', () => {
    expect(estaVacia([])).toBe(true);
    expect(estaVacia(['A'])).toBe(false);
    expect(validarPregunta(p, [])).toBe('Esta pregunta es obligatoria.');
    expect(validarPregunta({ ...p, obligatoria: false }, [])).toBeNull();
  });
  it('acepta opciones válidas y rechaza lo que no existe, repetidas o el tipo equivocado', () => {
    expect(validarPregunta(p, ['A', 'C'])).toBeNull();
    expect(validarPregunta(p, ['A', 'Z'])).toBe('Elija solo entre las opciones.');
    expect(validarPregunta(p, ['A', 'A'])).toBe('Hay opciones repetidas.');
    expect(validarPregunta(p, 'A')).toBe('Respuesta no válida.');
    expect(validarPregunta({ ...p, tipo: 'seleccion' }, ['A'])).toBe('Respuesta no válida.');
    expect(validarPregunta({ ...p, tipo: 'texto' }, ['A'])).toBe('Respuesta no válida.');
  });
  it('validarRespuestas normaliza (recorta) y rechaza listas con no-textos', () => {
    const d = valida(encuesta([multiple({ opciones: ['A', 'B', 'C'] })]));
    expect(validarRespuestas(d, { m1: [' A ', 'C'] })).toEqual({ ok: true, respuestas: { m1: ['A', 'C'] } });
    expect(validarRespuestas(d, { m1: [] }).ok).toBe(false);
    const mala = validarRespuestas(d, { m1: ['A', 5] });
    expect(mala.ok).toBe(false);
    if (!mala.ok) expect(mala.errores[0]).toEqual({ id: 'm1', mensaje: 'Respuesta no válida.' });
    expect(validarRespuestas(d, { m1: Array(60).fill('A') }).ok).toBe(false);
  });
  it('se muestra en la tabla y el Excel separada por «; »', () => {
    expect(textoDeRespuesta(['A', 'C'])).toBe('A; C');
  });
});

describe('calificar una selección múltiple: todo o nada', () => {
  const d = valida(
    evaluacion([
      multiple({ id: 'm1', puntos: 50, correctas: [0, 2] }),
      { id: 'u1', texto: 'Una', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b'], puntos: 50, correcta: 1 },
    ])
  );
  it('acierta solo con exactamente las correctas, en cualquier orden', () => {
    expect(calificar(d, { m1: ['A', 'C'], u1: 'b' })).toMatchObject({ porcentaje: 100, aprobado: true, correctas: 2 });
    expect(calificar(d, { m1: ['C', 'A'], u1: 'b' })).toMatchObject({ porcentaje: 100 });
  });
  it('una de menos, una de más o una equivocada no suman nada de esa pregunta', () => {
    expect(calificar(d, { m1: ['A'], u1: 'b' })).toMatchObject({ puntaje: 50, correctas: 1 });
    expect(calificar(d, { m1: ['A', 'B', 'C'], u1: 'b' })).toMatchObject({ puntaje: 50 });
    expect(calificar(d, { m1: ['A', 'B'], u1: 'b' })).toMatchObject({ puntaje: 50 });
    expect(calificar(d, { m1: [], u1: 'b' })).toMatchObject({ puntaje: 50 });
  });
  it('una respuesta de texto a una múltiple no puntúa', () => {
    expect(calificar(d, { m1: 'A', u1: 'b' }).puntaje).toBe(50);
  });
  it('una múltiple sin correctas definidas (borrador) no entra en la calificación', () => {
    const b = valida(evaluacion([multiple({ puntos: 10 })], { borrador: true }));
    expect(calificar(b, { m1: ['A'] })).toMatchObject({ calificadas: 0, aprobado: false });
  });
});
