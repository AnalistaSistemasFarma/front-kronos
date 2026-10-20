import { describe, expect, it } from 'vitest';
import { PREFIJO_OTRAS, textoDeRespuesta, validarDefinicion, validarPregunta, validarRespuestas, type DefinicionFormulario, type PreguntaFormulario } from '../formulario';

// Tipos de pregunta que piden los formularios de SST (Cristian Baldión, 2026-10-19): escala de 0 a 10, imagen dentro de una pregunta
// y selección múltiple con «Otras».

const base = (preguntas: unknown[]) => ({ formato: 1, codigo: 'SST-T', titulo: 'Prueba', preguntas });
const valida = (crudo: unknown): DefinicionFormulario => {
  const r = validarDefinicion(crudo);
  if (!r.ok) throw new Error(r.errores.join(' | '));
  return r.definicion;
};
const errores = (crudo: unknown): string => {
  const r = validarDefinicion(crudo);
  return r.ok ? '' : r.errores.join(' | ');
};
const escala = (extra: Record<string, unknown> = {}) => ({ id: 'e1', texto: 'Califique', tipo: 'escala', obligatoria: true, ...extra });

describe('escala', () => {
  it('por defecto va de 0 a 10', () => {
    const d = valida(base([escala()]));
    expect(d.preguntas[0].escala).toEqual({ min: 0, max: 10 });
  });
  it('acepta otros límites y rótulos en los extremos', () => {
    const d = valida(base([escala({ escala: { min: 1, max: 5, etiquetaMin: 'Muy poco dolor', etiquetaMax: 'Mucho dolor' } })]));
    expect(d.preguntas[0].escala).toEqual({ min: 1, max: 5, etiquetaMin: 'Muy poco dolor', etiquetaMax: 'Mucho dolor' });
  });
  it('rechaza límites inválidos, rótulos largos y «escala» en otro tipo', () => {
    for (const mala of [{ min: 5, max: 5 }, { min: 6, max: 2 }, { min: -1, max: 3 }, { min: 0, max: 21 }, { min: 0.5, max: 3 }, { min: '0', max: 3 }]) {
      expect(errores(base([escala({ escala: mala })])), JSON.stringify(mala)).toMatch(/la escala debe ir/);
    }
    expect(errores(base([escala({ escala: { etiquetaMin: 'x'.repeat(61) } })]))).toMatch(/rótulos de la escala/);
    expect(errores(base([{ id: 't1', texto: 'T', tipo: 'texto', obligatoria: true, escala: { min: 0, max: 3 } }]))).toMatch(/solo para el tipo escala/);
  });
  it('en una evaluación, una escala no puede llevar puntos (no es de selección)', () => {
    expect(errores({ formato: 1, codigo: 'E', titulo: 'E', tipo: 'evaluacion', preguntas: [escala({ puntos: 100 })] })).toMatch(/debe ser de selección/);
  });

  const p = (extra: Record<string, unknown> = {}) => valida(base([escala(extra)])).preguntas[0] as PreguntaFormulario;
  it('valida que la respuesta sea un entero dentro del rango, y que sea obligatoria si lo es', () => {
    const q = p();
    for (const ok of ['0', '5', '10']) expect(validarPregunta(q, ok), ok).toBeNull();
    for (const mal of ['11', '-1', '2.5', 'diez', '05x', '100']) expect(validarPregunta(q, mal), mal).toMatch(/Elija un valor de 0 a 10/);
    expect(validarPregunta(q, '')).toMatch(/obligatoria/);
    expect(validarPregunta(p({ obligatoria: false }), '')).toBeNull();
    expect(validarPregunta(p({ escala: { min: 1, max: 5 } }), '0')).toMatch(/de 1 a 5/);
  });
  it('el «0» es una respuesta válida y no cuenta como vacía', () => {
    const r = validarRespuestas(valida(base([escala()])), { e1: '0' });
    expect(r).toEqual({ ok: true, respuestas: { e1: '0' } });
  });
});

describe('imagen en la pregunta', () => {
  const conImagen = (im: unknown) => base([{ id: 'i1', texto: 'Seleccione la zona', tipo: 'seleccion_multiple', obligatoria: true, opciones: ['Cabeza'], imagen: im }]);
  it('acepta una imagen de /portal-th/ con su descripción', () => {
    const d = valida(conImagen({ src: '/portal-th/cuerpo-dolor.png', alt: 'Figura humana' }));
    expect(d.preguntas[0].imagen).toEqual({ src: '/portal-th/cuerpo-dolor.png', alt: 'Figura humana' });
  });
  it('solo imágenes de public/portal-th: ni otro sitio, ni otra carpeta, ni rutas raras ni otros formatos', () => {
    for (const src of ['https://sitio.com/a.png', '//sitio.com/a.png', '/otra/a.png', '/portal-th/../secreto.png', '/portal-th/a/b.png', '/portal-th/a.gif', '/portal-th/a.png?x=1', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '/portal-th/.png', '/portal-th/a b.png']) {
      expect(errores(conImagen({ src, alt: 'x' })), src).toMatch(/la imagen debe traer/);
    }
  });
  it('exige la descripción (accesibilidad)', () => {
    expect(errores(conImagen({ src: '/portal-th/a.png' }))).toMatch(/la imagen debe traer/);
    expect(errores(conImagen({ src: '/portal-th/a.png', alt: '   ' }))).toMatch(/la imagen debe traer/);
  });
});

describe('selección múltiple con «Otras»', () => {
  const m = (extra: Record<string, unknown> = {}) => valida(base([{ id: 'm1', texto: 'Zonas', tipo: 'seleccion_multiple', obligatoria: true, opciones: ['Cabeza', 'Cuello'], permiteOtra: true, ...extra }])).preguntas[0] as PreguntaFormulario;
  it('acepta opciones de la lista y un solo «Otras: texto»', () => {
    const q = m();
    expect(validarPregunta(q, ['Cabeza'])).toBeNull();
    expect(validarPregunta(q, ['Cabeza', `${PREFIJO_OTRAS}Ojo`])).toBeNull();
    expect(validarPregunta(q, [`${PREFIJO_OTRAS}Ojo`])).toBeNull();
  });
  it('rechaza dos «Otras», texto que no está en la lista y un «Otras:» vacío', () => {
    const q = m();
    expect(validarPregunta(q, [`${PREFIJO_OTRAS}Ojo`, `${PREFIJO_OTRAS}Nariz`])).toMatch(/una sola otra respuesta/);
    expect(validarPregunta(q, ['Nariz'])).toMatch(/solo entre las opciones/);
    expect(validarPregunta(q, [PREFIJO_OTRAS])).toMatch(/solo entre las opciones/);
    expect(validarPregunta(q, [`${PREFIJO_OTRAS}${'x'.repeat(2001)}`])).toMatch(/Máximo 2000/);
  });
  it('sin permiteOtra, «Otras: …» NO se acepta como opción (no se cuela texto libre)', () => {
    const q = m({ permiteOtra: false });
    expect(validarPregunta(q, [`${PREFIJO_OTRAS}Ojo`])).toMatch(/solo entre las opciones/);
  });
  it('se normaliza al validar y se muestra en la tabla y el Excel separada por «; »', () => {
    const d = valida(base([{ id: 'm1', texto: 'Zonas', tipo: 'seleccion_multiple', obligatoria: true, opciones: ['Cabeza', 'Cuello'], permiteOtra: true }]));
    const r = validarRespuestas(d, { m1: ['  Cabeza ', `${PREFIJO_OTRAS}Ojo `] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(textoDeRespuesta(r.respuestas.m1)).toBe('Cabeza; Otras: Ojo');
  });
});
