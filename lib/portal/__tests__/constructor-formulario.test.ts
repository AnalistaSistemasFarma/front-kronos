import { describe, expect, it } from 'vitest';
import { construirDefinicion, estadoInicial, preguntaVacia, type Estado, type PreguntaEditable } from '../constructor-formulario';
import { validarDefinicion } from '../formulario';

// Constructor manual de formularios (Cristian Baldión, 2026-10-09).

function pregunta(parche: Partial<PreguntaEditable> = {}): PreguntaEditable {
  return { ...preguntaVacia('evaluacion', []), texto: 'Enunciado', opciones: ['A', 'B', 'C'], puntos: 100, correcta: 1, ...parche };
}
function evaluacion(parche: Partial<Estado> = {}): Estado {
  return { ...estadoInicial('evaluacion'), titulo: 'Evaluación', codigo: 'EVA-1', preguntas: [pregunta()], ...parche };
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
