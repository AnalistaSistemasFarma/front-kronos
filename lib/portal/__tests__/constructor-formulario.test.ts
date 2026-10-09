import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizarImportacion } from '../importar-forms';
import {
  claveDeDato,
  construirDefinicion,
  conReparto,
  estadoDesdeImportacion,
  estadoInicial,
  preguntaVacia,
  puntosPorIgual,
  repartirPuntos,
  type Estado,
  type PreguntaEditable,
} from '../constructor-formulario';
import { validarDefinicion } from '../formulario';

// Constructor manual de formularios (Cristian Baldión, 2026-10-09).

function pregunta(parche: Partial<PreguntaEditable> = {}): PreguntaEditable {
  return { ...preguntaVacia('evaluacion', []), texto: 'Enunciado', opciones: ['A', 'B', 'C'], puntos: 100, correcta: 1, ...parche };
}
function evaluacion(parche: Partial<Estado> = {}): Estado {
  // Reparto manual: estas pruebas fijan los puntos a mano; el automático se prueba aparte.
  return { ...estadoInicial('evaluacion'), puntosAuto: false, titulo: 'Evaluación', codigo: 'EVA-1', preguntas: [pregunta()], ...parche };
}

describe('construirDefinicion: evaluación', () => {
  it('arma una evaluación válida: datos de la persona primero, correcta y puntos', () => {
    const r = construirDefinicion(evaluacion());
    expect(r.errores).toEqual([]);
    const d = r.definicion!;
    expect(d).toMatchObject({ tipo: 'evaluacion', notaMinima: 80, codigo: 'EVA-1' });
    // Por defecto pide nombre y cédula (con el aviso de la Ley 1581) y los pone al inicio.
    expect(d.preguntas.map((p) => p.id)).toEqual(['dato_nombre', 'dato_cedula', 'q1']);
    expect(d.preguntas[0]).toMatchObject({ prellenar: 'nombre', obligatoria: true });
    expect(d.preguntas[2]).toMatchObject({ puntos: 100, correcta: 1, tipo: 'seleccion' });
    expect(d.datosSensibles).toBe(true);
    expect(d.autorizacion?.pendienteValidacion).toBe(true);
  });

  it('los datos de la persona no puntúan y no cuentan en la suma', () => {
    const d = construirDefinicion(evaluacion()).definicion!;
    expect(d.preguntas[0].puntos).toBeUndefined();
  });

  it('sin cédula no agrega aviso de datos personales', () => {
    const d = construirDefinicion(evaluacion({ datos: { nombre: true, correo: true, cedula: false } })).definicion!;
    expect(d.autorizacion).toBeUndefined();
    expect(d.datosSensibles).toBeUndefined();
    expect(d.preguntas.map((p) => p.id)).toEqual(['dato_nombre', 'dato_correo', 'q1']);
  });

  it('avisa con la numeración que ve la persona', () => {
    const r = construirDefinicion(
      evaluacion({ titulo: '', preguntas: [pregunta(), pregunta({ id: 'q2', texto: '', puntos: '', correcta: null, opciones: ['solo', ''] })] })
    );
    expect(r.definicion).toBeNull();
    expect(r.errores).toEqual(
      expect.arrayContaining([
        'Escriba el título del formulario.',
        'Pregunta 2: escriba el enunciado.',
        'Pregunta 2: agregue al menos dos opciones.',
        'Pregunta 2: asigne los puntos (mayor que 0).',
        'Pregunta 2: marque cuál es la respuesta correcta.',
      ])
    );
  });

  it('exige que los puntos sumen 100', () => {
    const r = construirDefinicion(evaluacion({ preguntas: [pregunta({ puntos: 60 }), pregunta({ id: 'q2', puntos: 30 })] }));
    expect(r.errores).toEqual(['Los puntos deben sumar exactamente 100: hoy suman 90.']);
  });

  it('descarta opciones vacías y reubica la correcta entre las que quedan', () => {
    const d = construirDefinicion(evaluacion({ preguntas: [pregunta({ opciones: ['', 'A', '', 'B', ''], correcta: 3 })] })).definicion!;
    expect(d.preguntas[2].opciones).toEqual(['A', 'B']);
    expect(d.preguntas[2].correcta).toBe(1);
  });

  it('si la opción marcada como correcta quedó vacía, pide marcarla de nuevo', () => {
    const r = construirDefinicion(evaluacion({ preguntas: [pregunta({ opciones: ['A', 'B', ''], correcta: 2 })] }));
    expect(r.errores).toEqual(['Pregunta 1: marque cuál es la respuesta correcta.']);
  });

  it('rechaza opciones repetidas y nota mínima fuera de rango', () => {
    expect(construirDefinicion(evaluacion({ preguntas: [pregunta({ opciones: ['A', 'A'] })] })).errores).toContain('Pregunta 1: hay opciones repetidas.');
    expect(construirDefinicion(evaluacion({ notaMinima: 0 })).errores).toContain('La nota mínima para aprobar debe estar entre 1 y 100.');
    expect(construirDefinicion(evaluacion({ notaMinima: '' })).errores).toContain('La nota mínima para aprobar debe estar entre 1 y 100.');
  });

  it('el borrador se guarda incompleto: sin correcta ni suma de 100', () => {
    const r = construirDefinicion(
      evaluacion({ borrador: true, preguntas: [pregunta({ puntos: 10, correcta: null }), pregunta({ id: 'q2', puntos: 10, correcta: 0 })] })
    );
    expect(r.errores).toEqual([]);
    expect(r.definicion).toMatchObject({ borrador: true });
    expect(r.definicion!.preguntas[2].correcta).toBeUndefined();
    expect(r.definicion!.preguntas[3].correcta).toBe(0);
  });

  it('lo que construye lo acepta el validador del servidor tal cual', () => {
    const d = construirDefinicion(evaluacion()).definicion!;
    expect(validarDefinicion(JSON.parse(JSON.stringify(d))).ok).toBe(true);
  });

  it('una pregunta de texto dentro de una evaluación es un dato sin puntos', () => {
    const d = construirDefinicion(
      evaluacion({ preguntas: [pregunta(), { ...preguntaVacia('evaluacion', []), id: 'cargo', texto: 'Cargo', tipo: 'texto', opciones: [], puntos: '', correcta: null }] })
    ).definicion!;
    const cargo = d.preguntas.find((p) => p.id === 'cargo')!;
    expect(cargo.puntos).toBeUndefined();
    expect(cargo.correcta).toBeUndefined();
  });
});

describe('construirDefinicion: encuesta', () => {
  const encuesta = (parche: Partial<Estado> = {}): Estado => ({
    ...estadoInicial('encuesta'),
    titulo: 'Perfil',
    codigo: 'ENC-1',
    preguntas: [{ ...preguntaVacia('encuesta', []), texto: '¿Cómo se llama?' }],
    ...parche,
  });

  it('una encuesta no lleva tipo, nota mínima, puntos ni correctas', () => {
    const d = construirDefinicion(encuesta()).definicion!;
    expect(d.tipo).toBeUndefined();
    expect(d.notaMinima).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/puntos|correcta|borrador/);
  });

  it('una pregunta de selección acepta "Otra respuesta" y una sola opción', () => {
    const d = construirDefinicion(
      encuesta({ preguntas: [{ ...preguntaVacia('encuesta', []), texto: 'Sexo', tipo: 'seleccion', opciones: ['F', 'M'], permiteOtra: true }] })
    ).definicion!;
    expect(d.preguntas[0]).toMatchObject({ tipo: 'seleccion', opciones: ['F', 'M'], permiteOtra: true, obligatoria: true });
  });

  it('Sí/No no lleva opciones', () => {
    const d = construirDefinicion(encuesta({ preguntas: [{ ...preguntaVacia('encuesta', []), texto: '¿Fuma?', tipo: 'si_no' }] })).definicion!;
    expect(d.preguntas[0].opciones).toBeUndefined();
  });
});

describe('editar una definición existente conserva lo que el editor no muestra', () => {
  it('autorización de datos, "otra respuesta", ayuda y prellenado sobreviven a cargar y guardar', () => {
    const original = {
      formato: 1,
      codigo: 'SST-X',
      titulo: 'Perfil',
      datosSensibles: true,
      autorizacion: { version: 'AUT-9', titulo: 'Aviso', texto: ['Texto'], casilla: 'Acepto', pendienteValidacion: true },
      preguntas: [
        { id: 'p01', texto: 'Correo', tipo: 'texto', obligatoria: true, prellenar: 'correo' },
        { id: 'p02', texto: 'Sexo', tipo: 'seleccion', obligatoria: true, opciones: ['F', 'M'], permiteOtra: true, ayuda: 'Elija una' },
      ],
    };
    const v = validarDefinicion(original);
    if (!v.ok) throw new Error('inválida');
    const e = estadoInicial('encuesta', v.definicion);
    const d = construirDefinicion(e).definicion!;
    expect(d.autorizacion).toEqual(original.autorizacion);
    expect(d.datosSensibles).toBe(true);
    expect(d.preguntas[0]).toMatchObject({ id: 'p01', prellenar: 'correo' });
    expect(d.preguntas[1]).toMatchObject({ id: 'p02', permiteOtra: true, ayuda: 'Elija una' });
    expect(d.codigo).toBe('SST-X');
  });

  it('una evaluación guardada se reabre con sus puntos, correctas y nota mínima', () => {
    const d = construirDefinicion(evaluacion({ notaMinima: 70 })).definicion!;
    const e = estadoInicial('evaluacion', d);
    expect(e).toMatchObject({ tipo: 'evaluacion', notaMinima: 70, datos: { nombre: true, correo: false, cedula: true } });
    expect(e.preguntas).toHaveLength(1);
    expect(e.preguntas[0]).toMatchObject({ puntos: 100, correcta: 1 });
    expect(construirDefinicion(e).definicion).toEqual(d);
  });
});

describe('reparto automático de los 100 puntos (Cristian, 2026-10-09)', () => {
  const calificadas = (e: Estado) => e.preguntas.map((p) => p.puntos);

  it('100 ÷ número de preguntas: 10 preguntas = 10 puntos cada una', () => {
    expect(puntosPorIgual(10)).toEqual(Array(10).fill(10));
    expect(puntosPorIgual(4)).toEqual([25, 25, 25, 25]);
    expect(puntosPorIgual(1)).toEqual([100]);
    expect(puntosPorIgual(0)).toEqual([]);
  });

  it('si no divide exacto, la última se lleva el resto y la suma es exactamente 100', () => {
    expect(puntosPorIgual(3)).toEqual([33.33, 33.33, 33.34]);
    expect(puntosPorIgual(6)).toEqual([16.66, 16.66, 16.66, 16.66, 16.66, 16.7]);
    for (let n = 1; n <= 60; n++) expect(Math.round(puntosPorIgual(n).reduce((s, x) => s + x, 0) * 100) / 100).toBe(100);
  });

  it('una evaluación nueva empieza con el reparto automático encendido', () => {
    const e = estadoInicial('evaluacion');
    expect(e.puntosAuto).toBe(true);
    expect(calificadas(e)).toEqual([100]);
  });

  it('al agregar o quitar preguntas, se recalcula solo', () => {
    let e = estadoInicial('evaluacion');
    e = conReparto({ ...e, preguntas: [...e.preguntas, preguntaVacia('evaluacion', e.preguntas)] });
    expect(calificadas(e)).toEqual([50, 50]);
    e = conReparto({ ...e, preguntas: [...e.preguntas, preguntaVacia('evaluacion', e.preguntas)] });
    expect(calificadas(e)).toEqual([33.33, 33.33, 33.34]);
    e = conReparto({ ...e, preguntas: e.preguntas.slice(0, 1) });
    expect(calificadas(e)).toEqual([100]);
  });

  it('las preguntas de datos (texto) no cuentan en el reparto', () => {
    const e = repartirPuntos({
      ...estadoInicial('evaluacion'),
      preguntas: [pregunta({ puntos: '' }), { ...preguntaVacia('evaluacion', []), id: 'cargo', texto: 'Cargo', tipo: 'texto', puntos: '' }, pregunta({ id: 'q3', puntos: '' })],
    });
    expect(calificadas(e)).toEqual([50, '', 50]);
  });

  it('con el reparto apagado no toca los puntos que puso la persona', () => {
    const e = conReparto({ ...evaluacion(), preguntas: [pregunta({ puntos: 70 }), pregunta({ id: 'q2', puntos: 30 })] });
    expect(calificadas(e)).toEqual([70, 30]);
  });

  it('guardar con el reparto encendido da una evaluación válida que suma 100', () => {
    const e = { ...estadoInicial('evaluacion'), titulo: 'Eva', codigo: 'EVA-9' };
    const con10 = { ...e, preguntas: Array.from({ length: 10 }, (_, i) => pregunta({ id: 'q' + (i + 1), puntos: '' })) };
    const d = construirDefinicion(con10).definicion!;
    const puntos = d.preguntas.filter((p) => p.puntos !== undefined).map((p) => p.puntos);
    expect(puntos).toEqual(Array(10).fill(10));
  });

  it('al editar, se enciende solo si ya estaban repartidos por igual', () => {
    const igual = construirDefinicion(evaluacion({ preguntas: [pregunta({ puntos: 50 }), pregunta({ id: 'q2', puntos: 50 })] })).definicion!;
    expect(estadoInicial('evaluacion', igual).puntosAuto).toBe(true);
    const desigual = construirDefinicion(evaluacion({ preguntas: [pregunta({ puntos: 70 }), pregunta({ id: 'q2', puntos: 30 })] })).definicion!;
    const reabierta = estadoInicial('evaluacion', desigual);
    expect(reabierta.puntosAuto).toBe(false);
    expect(calificadas(reabierta)).toEqual(['', '', 70, 30].slice(2));
  });
});

describe('importar desde Microsoft Forms (Cristian, 2026-10-09)', () => {
  const CRUDO = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'forms-evaluacion-induccion-crudo.json'), 'utf8'));
  const imp = () => normalizarImportacion(CRUDO);

  it('reconoce los datos de la persona por su enunciado', () => {
    expect(claveDeDato('Nombre Completo')).toBe('nombre');
    expect(claveDeDato('Nombres y apellidos:')).toBe('nombre');
    expect(claveDeDato('Apellidos y nombres')).toBe('nombre');
    expect(claveDeDato('Número de cédula')).toBe('cedula');
    expect(claveDeDato('Cédula de ciudadanía')).toBe('cedula');
    expect(claveDeDato('Número de documento')).toBe('cedula');
    expect(claveDeDato('Correo electrónico')).toBe('correo');
    expect(claveDeDato('E-mail')).toBe('correo');
    // Una pregunta de contenido NO es un dato de la persona.
    expect(claveDeDato('¿Cuál es el nombre del jefe de SST?')).toBeNull();
    expect(claveDeDato('Describa el documento que debe presentar en la entrada de la planta')).toBeNull();
  });

  it('evaluación: nombre y cédula pasan a "Datos que se piden"; las 10 de selección entran sin correcta, en borrador', () => {
    const e = estadoDesdeImportacion('evaluacion', imp());
    expect(e).toMatchObject({ tipo: 'evaluacion', puntosAuto: true, borrador: true, datos: { nombre: true, cedula: true, correo: false } });
    expect(e.titulo).toBe('Evaluación Inducción Organizacional y SST Farmalógica SA 2025');
    expect(e.preguntas).toHaveLength(10);
    expect(e.preguntas.map((p) => p.id)).toEqual(Array.from({ length: 10 }, (_, i) => 'q' + (i + 1)));
    expect(e.preguntas.every((p) => p.tipo === 'seleccion' && p.correcta === null && p.opciones.length === 4)).toBe(true);
    // 100 ÷ 10 = 10 puntos cada una, automático.
    expect(e.preguntas.every((p) => p.puntos === 10)).toBe(true);
  });

  it('sin marcar las correctas no se puede guardar como publicada, pero sí como borrador', () => {
    const e = estadoDesdeImportacion('evaluacion', imp());
    const publicada = construirDefinicion({ ...e, borrador: false });
    expect(publicada.definicion).toBeNull();
    expect(publicada.errores).toContain('Pregunta 1: marque cuál es la respuesta correcta.');
    const borrador = construirDefinicion(e);
    expect(borrador.errores).toEqual([]);
    expect(borrador.definicion).toMatchObject({ tipo: 'evaluacion', borrador: true, notaMinima: 80 });
  });

  it('al marcar las correctas queda una evaluación válida que suma 100 y se puede publicar', () => {
    const e = estadoDesdeImportacion('evaluacion', imp());
    const lista = { ...e, borrador: false, preguntas: e.preguntas.map((p) => ({ ...p, correcta: 0 })) };
    const r = construirDefinicion(lista);
    expect(r.errores).toEqual([]);
    const d = r.definicion!;
    expect(d.preguntas.slice(0, 2).map((p) => p.id)).toEqual(['dato_nombre', 'dato_cedula']);
    expect(d.preguntas.filter((p) => p.puntos !== undefined)).toHaveLength(10);
    expect(d.autorizacion?.pendienteValidacion).toBe(true);
  });

  it('encuesta: no es borrador ni lleva puntos; conserva texto, lista y obligatoriedad', () => {
    const e = estadoDesdeImportacion('encuesta', {
      titulo: 'Satisfacción',
      descripcion: 'Cuéntenos',
      advertencias: [],
      preguntas: [
        { texto: 'Correo electrónico', obligatoria: true, tipo: 'texto', opciones: [] },
        { texto: '¿Qué le pareció?', obligatoria: false, tipo: 'texto_largo', opciones: [] },
        { texto: '¿Volvería?', obligatoria: true, tipo: 'seleccion', opciones: ['Sí', 'No'] },
      ],
    });
    expect(e).toMatchObject({ tipo: 'encuesta', borrador: false, datos: { correo: true, nombre: false, cedula: false } });
    expect(e.preguntas.map((p) => [p.tipo, p.obligatoria])).toEqual([['texto_largo', false], ['seleccion', true]]);
    const d = construirDefinicion(e).definicion!;
    expect(d.tipo).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/puntos|correcta|borrador/);
  });

  it('un dato repetido (dos "Nombre") solo se toma una vez; el segundo queda como pregunta', () => {
    const e = estadoDesdeImportacion('encuesta', {
      titulo: 'T', descripcion: '', advertencias: [],
      preguntas: [
        { texto: 'Nombre', obligatoria: true, tipo: 'texto', opciones: [] },
        { texto: 'Nombre', obligatoria: true, tipo: 'texto', opciones: [] },
      ],
    });
    expect(e.datos.nombre).toBe(true);
    expect(e.preguntas).toHaveLength(1);
  });

  it('una evaluación importada sin preguntas de selección no queda en borrador', () => {
    const e = estadoDesdeImportacion('evaluacion', { titulo: 'T', descripcion: '', advertencias: [], preguntas: [{ texto: 'Cargo', obligatoria: true, tipo: 'texto', opciones: [] }] });
    expect(e.borrador).toBe(false);
  });

  it('lo importado se puede reabrir y editar como cualquier formulario guardado', () => {
    const e = estadoDesdeImportacion('evaluacion', imp());
    const d = construirDefinicion({ ...e, borrador: false, preguntas: e.preguntas.map((p) => ({ ...p, correcta: 1 })) }).definicion!;
    const reabierto = estadoInicial('evaluacion', d);
    expect(reabierto.preguntas).toHaveLength(10);
    expect(reabierto.puntosAuto).toBe(true);
    expect(construirDefinicion(reabierto).definicion).toEqual(d);
  });
});
