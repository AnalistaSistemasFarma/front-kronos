import { describe, expect, it } from 'vitest';
import { construirDefinicion, estadoDesdeImportacion, estadoInicial, preguntaVacia, type Estado, type PreguntaEditable } from '../constructor-formulario';
import { normalizarImportacion } from '../importar-forms';
import { calificar, validarDefinicion } from '../formulario';

// Selección múltiple y lista desplegable en el constructor y al importar de Forms (Cristian Baldión, 2026-10-14).

function pregunta(parche: Partial<PreguntaEditable> = {}): PreguntaEditable {
  return { ...preguntaVacia('evaluacion', []), texto: 'Enunciado', opciones: ['A', 'B', 'C', 'D'], puntos: 100, correcta: 1, ...parche };
}
function evaluacion(preguntas: PreguntaEditable[], parche: Partial<Estado> = {}): Estado {
  return { ...estadoInicial('evaluacion'), puntosAuto: false, titulo: 'Evaluación', codigo: 'EVA-M', preguntas, ...parche };
}
function encuesta(preguntas: PreguntaEditable[]): Estado {
  return { ...estadoInicial('encuesta'), titulo: 'Encuesta', codigo: 'ENC-M', preguntas };
}
const enc = (parche: Partial<PreguntaEditable>) => ({ ...preguntaVacia('encuesta', []), texto: 'Pregunta', ...parche });

describe('construirDefinicion: selección múltiple', () => {
  it('evaluación: guarda las correctas (todas las marcadas) y puntúa', () => {
    const m = pregunta({ tipo: 'seleccion_multiple', correcta: null, correctas: [0, 2], puntos: 100 });
    const r = construirDefinicion(evaluacion([m]));
    expect(r.errores).toEqual([]);
    const q = r.definicion!.preguntas.find((p) => p.id === m.id)!;
    expect(q).toMatchObject({ tipo: 'seleccion_multiple', puntos: 100, correctas: [0, 2], obligatoria: true });
    expect(q.correcta).toBeUndefined();
    expect(calificar(r.definicion!, { [m.id]: ['A', 'C'] }).porcentaje).toBe(100);
  });

  it('pide marcar al menos una correcta (salvo en borrador)', () => {
    const m = pregunta({ tipo: 'seleccion_multiple', correcta: null, correctas: [] });
    expect(construirDefinicion(evaluacion([m])).errores).toContain('Pregunta 1: marque cuáles son las respuestas correctas.');
    expect(construirDefinicion(evaluacion([m], { borrador: true })).errores).toEqual([]);
  });

  it('descarta opciones vacías y reubica TODAS las correctas', () => {
    const m = pregunta({ tipo: 'seleccion_multiple', correcta: null, opciones: ['', 'A', '', 'B', 'C'], correctas: [1, 4] });
    const q = construirDefinicion(evaluacion([m])).definicion!.preguntas.find((p) => p.id === m.id)!;
    expect(q.opciones).toEqual(['A', 'B', 'C']);
    expect(q.correctas).toEqual([0, 2]);
  });

  it('una selección múltiple de una encuesta no lleva correctas, puntos ni "otra respuesta"', () => {
    const d = construirDefinicion(encuesta([enc({ tipo: 'seleccion_multiple', opciones: ['A', 'B'], permiteOtra: true })])).definicion!;
    expect(d.preguntas[0]).toMatchObject({ tipo: 'seleccion_multiple', opciones: ['A', 'B'] });
    expect(JSON.stringify(d)).not.toMatch(/correctas|puntos|permiteOtra/);
  });

  it('el reparto automático cuenta también las múltiples', () => {
    const e = estadoDesdeImportacion('evaluacion', {
      titulo: 'T',
      descripcion: '',
      advertencias: [],
      preguntas: [
        { texto: 'Uno', obligatoria: true, tipo: 'seleccion', opciones: ['a', 'b'] },
        { texto: 'Varias', obligatoria: true, tipo: 'seleccion_multiple', opciones: ['a', 'b', 'c'] },
      ],
    });
    expect(e.preguntas.map((p) => p.puntos)).toEqual([50, 50]);
  });
});

describe('construirDefinicion: lista desplegable', () => {
  it('guarda presentacion "lista" solo en una selección única', () => {
    const d = construirDefinicion(encuesta([enc({ tipo: 'seleccion', lista: true, opciones: ['x', 'y'] }), enc({ id: 'q2', tipo: 'seleccion', lista: false, opciones: ['x', 'y'] })])).definicion!;
    expect(d.preguntas[0].presentacion).toBe('lista');
    expect(d.preguntas[1].presentacion).toBeUndefined();
  });
  it('una múltiple nunca sale como lista aunque el estado lo diga', () => {
    const d = construirDefinicion(encuesta([enc({ tipo: 'seleccion_multiple', lista: true, opciones: ['x', 'y'] })])).definicion!;
    expect(d.preguntas[0].presentacion).toBeUndefined();
  });
  it('evaluación: una lista con puntos y su correcta', () => {
    const q = construirDefinicion(evaluacion([pregunta({ lista: true, correcta: 2 })])).definicion!.preguntas.find((p) => p.tipo === 'seleccion')!;
    expect(q).toMatchObject({ presentacion: 'lista', correcta: 2, puntos: 100 });
  });
});

describe('editar una definición con múltiple y lista', () => {
  it('se reabre igual y se vuelve a guardar idéntica', () => {
    const original = {
      formato: 1,
      codigo: 'EVA-R',
      titulo: 'R',
      tipo: 'evaluacion',
      notaMinima: 80,
      preguntas: [
        { id: 'q1', texto: 'Varias', tipo: 'seleccion_multiple', obligatoria: true, opciones: ['a', 'b', 'c'], puntos: 50, correctas: [0, 2] },
        { id: 'q2', texto: 'Lista', tipo: 'seleccion', obligatoria: true, opciones: ['x', 'y'], puntos: 50, correcta: 1, presentacion: 'lista' },
      ],
    };
    const v = validarDefinicion(original);
    if (!v.ok) throw new Error(v.errores.join('|'));
    const e = estadoInicial('evaluacion', v.definicion);
    expect(e.preguntas[0]).toMatchObject({ tipo: 'seleccion_multiple', correctas: [0, 2], lista: false });
    expect(e.preguntas[1]).toMatchObject({ tipo: 'seleccion', correcta: 1, lista: true });
    expect(e.puntosAuto).toBe(true);
    expect(construirDefinicion(e).definicion).toEqual(v.definicion);
  });
});

describe('importar de Forms hacia el constructor', () => {
  const crudo = {
    titulo: 'Evaluación PTEE 2025',
    preguntas: [
      { titulo: 'Correo', tipo: 'texto', obligatoria: true, opciones: [] },
      { titulo: 'Nombre y cédula', tipo: 'texto', obligatoria: true, opciones: [] },
      { titulo: 'Defina el PTEE', tipo: 'seleccion', obligatoria: true, opciones: ['a', 'b', 'c'] },
      { titulo: 'Elija una política', tipo: 'seleccion', lista: true, obligatoria: true, opciones: ['p1', 'p2'] },
      { titulo: 'Seleccione 3 elementos de un PTEE', tipo: 'multiple', obligatoria: true, opciones: ['e1', 'e2', 'e3', 'e4', 'e5'] },
      { titulo: 'Seleccione 3 políticas del PTEE', tipo: 'multiple', obligatoria: true, opciones: ['x1', 'x2', 'x3', 'x4'] },
    ],
  };
  it('las múltiples y las listas ya no se pierden: llegan a la evaluación como borrador, sin correctas', () => {
    const imp = normalizarImportacion(crudo);
    expect(imp.advertencias.join(' ')).not.toMatch(/selección múltiple/);
    const e = estadoDesdeImportacion('evaluacion', imp);
    const sel = e.preguntas.filter((p) => p.tipo !== 'texto');
    expect(sel.map((p) => [p.tipo, p.lista])).toEqual([
      ['seleccion', false],
      ['seleccion', true],
      ['seleccion_multiple', false],
      ['seleccion_multiple', false],
    ]);
    expect(e.preguntas.every((p) => p.correcta === null && p.correctas.length === 0)).toBe(true);
    expect(e.borrador).toBe(true);
    expect(e.preguntas.filter((p) => p.puntos !== '').every((p) => p.puntos === 25)).toBe(true);
  });
  it('quien crea el curso marca las correctas (una sola o varias) y puede publicar', () => {
    const e = estadoDesdeImportacion('evaluacion', normalizarImportacion(crudo));
    const lista = {
      ...e,
      borrador: false,
      preguntas: e.preguntas.map((p) => (p.tipo === 'seleccion_multiple' ? { ...p, correctas: [0, 1, 2] } : p.tipo === 'seleccion' ? { ...p, correcta: 0 } : p)),
    };
    const r = construirDefinicion(lista);
    expect(r.errores).toEqual([]);
    expect(r.definicion!.preguntas.filter((p) => p.correctas).map((p) => p.correctas)).toEqual([[0, 1, 2], [0, 1, 2]]);
  });
  it('una encuesta importada conserva la múltiple y la lista, sin puntos ni borrador', () => {
    const e = estadoDesdeImportacion('encuesta', normalizarImportacion(crudo));
    expect(e.borrador).toBe(false);
    const d = construirDefinicion(e).definicion!;
    expect(d.preguntas.map((p) => p.tipo).filter((t) => t.startsWith('seleccion'))).toEqual(['seleccion', 'seleccion', 'seleccion_multiple', 'seleccion_multiple']);
    expect(JSON.stringify(d)).not.toMatch(/puntos|correcta/);
  });
});
