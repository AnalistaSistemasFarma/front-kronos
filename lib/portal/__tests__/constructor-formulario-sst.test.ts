import { describe, expect, it } from 'vitest';
import { AUTORIZACION_ESTANDAR, AUTORIZACION_SST, construirDefinicion, estadoInicial, preguntaVacia, type Estado, type PreguntaEditable } from '../constructor-formulario';
import { FORMULARIOS_SST } from '../formularios-sst';

// Constructor visual para los formularios SST (Cristian Baldión, 2026-10-20): lo que el constructor de Formación perdía al editar.

const [REPORTE, SALUD] = FORMULARIOS_SST;
const abrir = (f: (typeof FORMULARIOS_SST)[number]) => estadoInicial('encuesta', f.definicion, 'sst');
const nuevo = (parche: Partial<Estado> = {}): Estado => ({ ...estadoInicial('encuesta', undefined, 'sst'), titulo: 'Reporte nuevo', codigo: 'SST-NUEVO', ...parche });
const pregunta = (parche: Partial<PreguntaEditable> = {}): PreguntaEditable => ({ ...preguntaVacia('encuesta', []), texto: 'Pregunta', ...parche });

describe('abrir y volver a guardar un formulario SST sin cambiarlo', () => {
  it('B1 (reporte de actos y condiciones inseguras) sale idéntico', () => {
    const r = construirDefinicion(abrir(REPORTE));
    expect(r.errores).toEqual([]);
    expect(r.definicion).toEqual(REPORTE.definicion);
  });
  it('B2 (salud y sintomatología) sale idéntico: autorización, escala, imagen y «Otras» múltiple incluidos', () => {
    const r = construirDefinicion(abrir(SALUD));
    expect(r.errores).toEqual([]);
    expect(r.definicion).toEqual(SALUD.definicion);
  });
  it('el código no cambia y sigue siendo una encuesta', () => {
    const d = construirDefinicion(abrir(SALUD)).definicion!;
    expect(d.codigo).toBe('SST-SALUD-OSTEOMUSCULAR');
    expect(d.tipo ?? 'encuesta').toBe('encuesta');
  });
});

describe('lo que antes se perdía al editar', () => {
  it('la imagen de una pregunta se conserva, y se puede quitar', () => {
    const e = abrir(SALUD);
    const i = e.preguntas.findIndex((p) => p.id === 'o10');
    expect(e.preguntas[i].imagen?.src).toBe('/portal-th/cuerpo-dolor.png');
    expect(construirDefinicion(e).definicion!.preguntas.find((p) => p.id === 'o10')!.imagen).toEqual(SALUD.definicion.preguntas.find((p) => p.id === 'o10')!.imagen);
    const sin = { ...e, preguntas: e.preguntas.map((p, j) => (j === i ? { ...p, imagen: undefined } : p)) };
    expect(construirDefinicion(sin).definicion!.preguntas.find((p) => p.id === 'o10')!.imagen).toBeUndefined();
  });
  it('la escala conserva sus límites y rótulos, y se puede cambiar', () => {
    const e = abrir(SALUD);
    const i = e.preguntas.findIndex((p) => p.id === 'o11');
    expect(e.preguntas[i].escala).toEqual({ min: 0, max: 10, etiquetaMin: 'Muy poco dolor', etiquetaMax: 'Mucho dolor' });
    const cambiado = { ...e, preguntas: e.preguntas.map((p, j) => (j === i ? { ...p, escala: { min: 1, max: 5, etiquetaMin: '  Poco  ', etiquetaMax: '' } } : p)) };
    expect(construirDefinicion(cambiado).definicion!.preguntas.find((p) => p.id === 'o11')!.escala).toEqual({ min: 1, max: 5, etiquetaMin: 'Poco' });
  });
  it('una selección múltiple conserva «Otras»', () => {
    const q = construirDefinicion(abrir(SALUD)).definicion!.preguntas.find((p) => p.id === 'o07')!;
    expect(q).toMatchObject({ tipo: 'seleccion_multiple', permiteOtra: true });
  });
  it('el nombre prellenado de la sesión y la autorización pendiente de validación se conservan', () => {
    const b1 = construirDefinicion(abrir(REPORTE)).definicion!;
    expect(b1.preguntas[0].prellenar).toBe('nombre');
    const b2 = construirDefinicion(abrir(SALUD)).definicion!;
    expect(b2.datosSensibles).toBe(true);
    expect(b2.autorizacion?.pendienteValidacion).toBe(true);
    expect(b2.autorizacion?.version).toBe(SALUD.definicion.autorizacion!.version);
  });
});

describe('pregunta de escala nueva', () => {
  it('por defecto de 0 a 10; límites y rótulos se guardan', () => {
    const e = nuevo({ preguntas: [pregunta({ tipo: 'escala' })] });
    expect(construirDefinicion(e).definicion!.preguntas[0].escala).toEqual({ min: 0, max: 10 });
    const con = nuevo({ preguntas: [pregunta({ tipo: 'escala', escala: { min: 1, max: 7, etiquetaMin: 'Nada', etiquetaMax: 'Todo' } })] });
    expect(construirDefinicion(con).definicion!.preguntas[0].escala).toEqual({ min: 1, max: 7, etiquetaMin: 'Nada', etiquetaMax: 'Todo' });
  });
  it('límites vacíos o imposibles se avisan con el número de la pregunta', () => {
    const vacio = construirDefinicion(nuevo({ preguntas: [pregunta({ tipo: 'escala', escala: { min: '', max: 5, etiquetaMin: '', etiquetaMax: '' } })] }));
    expect(vacio.definicion).toBeNull();
    expect(vacio.errores).toContain('Pregunta 1: escriba el valor mínimo y el máximo de la escala.');
    for (const [min, max] of [[5, 5], [6, 2], [0, 21]] as const) {
      const r = construirDefinicion(nuevo({ preguntas: [pregunta({ tipo: 'escala', escala: { min, max, etiquetaMin: '', etiquetaMax: '' } })] }));
      expect(r.definicion, `${min}-${max}`).toBeNull();
      expect(r.errores.join(' ')).toMatch(/la escala debe ir/);
    }
  });
});

describe('formulario SST nuevo', () => {
  it('el código propuesto lleva el prefijo SST y el de Formación no', () => {
    expect(estadoInicial('encuesta', undefined, 'sst').codigo).toMatch(/^SST-ENC-[0-9]{8}-[0-9]{6}$/);
    expect(estadoInicial('encuesta').codigo).toMatch(/^ENC-[0-9]{8}-[0-9]{6}$/);
  });
  it('sin datos sensibles no lleva autorización; con ellos, la de Seguridad y Salud en el Trabajo (borrador pendiente de validar)', () => {
    const base = { preguntas: [pregunta({ tipo: 'texto_largo' })] };
    const sin = construirDefinicion(nuevo(base)).definicion!;
    expect(sin.datosSensibles).toBeUndefined();
    expect(sin.autorizacion).toBeUndefined();
    const con = construirDefinicion(nuevo({ ...base, datosSensibles: true })).definicion!;
    expect(con.datosSensibles).toBe(true);
    expect(con.autorizacion?.version).toBe(AUTORIZACION_SST.version);
    expect(con.autorizacion?.pendienteValidacion).toBe(true);
    expect(JSON.stringify(con.autorizacion)).toMatch(/Seguridad y Salud en el Trabajo/);
    expect(JSON.stringify(con.autorizacion)).not.toMatch(/gestionar su formaci/);
  });
  it('pedir la cédula en un formulario SST usa la autorización de SST; en Formación sigue la estándar', () => {
    const base = { preguntas: [pregunta()] };
    const sst = nuevo({ ...base, datos: { nombre: false, correo: false, cedula: true } });
    expect(construirDefinicion(sst).definicion!.autorizacion?.version).toBe(AUTORIZACION_SST.version);
    const formacion = { ...estadoInicial('encuesta'), titulo: 'E', codigo: 'ENC-X', ...base, datos: { nombre: false, correo: false, cedula: true } };
    expect(construirDefinicion(formacion).definicion!.autorizacion?.version).toBe(AUTORIZACION_ESTANDAR.version);
  });
  it('«Otras» en una selección múltiple nueva sale en la definición', () => {
    const e = nuevo({ preguntas: [pregunta({ tipo: 'seleccion_multiple', opciones: ['A', 'B'], permiteOtra: true })] });
    expect(construirDefinicion(e).definicion!.preguntas[0]).toMatchObject({ tipo: 'seleccion_multiple', permiteOtra: true });
  });
});
