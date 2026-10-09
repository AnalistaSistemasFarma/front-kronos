import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizarImportacion, sinLetra, sinNumeracion, validarEnlaceForms } from '../importar-forms';

// Importar desde Microsoft Forms (Cristian Baldión, 2026-10-09).

const CRUDO = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'forms-evaluacion-induccion-crudo.json'), 'utf8'));

describe('validarEnlaceForms', () => {
  it('acepta los enlaces de Microsoft Forms con https', () => {
    for (const u of [
      'https://forms.cloud.microsoft/pages/responsepage.aspx?id=abc&route=shorturl',
      'https://forms.office.com/r/AbC123',
      'https://forms.microsoft.com/Pages/ResponsePage.aspx?id=xyz',
      '  https://FORMS.OFFICE.COM/r/AbC123  ',
    ]) {
      const r = validarEnlaceForms(u);
      expect(r.ok).toBe(true);
    }
  });

  it('rechaza lo que no es de Microsoft Forms, o es inseguro', () => {
    for (const u of [
      '',
      '   ',
      'forms.office.com/r/AbC',
      'http://forms.office.com/r/AbC',
      'https://evil.com/forms.office.com',
      'https://forms.office.com.evil.com/r/AbC',
      'https://evil.forms.office.com/r/AbC',
      'https://forms.office.com@evil.com/r/AbC',
      'https://user:pass@forms.office.com/r/AbC',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost:3000/',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://forms.office.com/' + 'a'.repeat(2100),
    ]) {
      expect(validarEnlaceForms(u).ok, u.slice(0, 50)).toBe(false);
    }
    for (const x of [null, undefined, 42, {}, []]) expect(validarEnlaceForms(x).ok).toBe(false);
  });
});

describe('sinNumeracion / sinLetra', () => {
  it('quita la numeración del autor y la letra escrita a mano', () => {
    expect(sinNumeracion('1. Según el reglamento')).toBe('Según el reglamento');
    expect(sinNumeracion('12) ¿Cuál es?')).toBe('¿Cuál es?');
    expect(sinNumeracion('7.¿Cuáles son?')).toBe('¿Cuáles son?');
    expect(sinNumeracion('Nombre Completo')).toBe('Nombre Completo');
    expect(sinNumeracion('2026 fue un año')).toBe('2026 fue un año');
    expect(sinLetra('d. Solo está prohibido')).toBe('Solo está prohibido');
    expect(sinLetra('a) Primera')).toBe('Primera');
    expect(sinLetra('Alta prioridad')).toBe('Alta prioridad');
    expect(sinLetra('b.')).toBe('b.'); // ya trimmada: una letra sola no se toca
  });
});

describe('normalizarImportacion', () => {
  it('el Forms real de Inducción: 12 preguntas, 10 de selección con 4 opciones, sin numeración del autor', () => {
    const i = normalizarImportacion(CRUDO);
    expect(i.titulo).toBe('Evaluación Inducción Organizacional y SST Farmalógica SA 2025');
    expect(i.preguntas).toHaveLength(12);
    expect(i.advertencias).toEqual([]);
    expect(i.preguntas.slice(0, 2).map((p) => [p.texto, p.tipo])).toEqual([
      ['Nombre Completo', 'texto'],
      ['Número de cédula', 'texto'],
    ]);
    const sel = i.preguntas.filter((p) => p.tipo === 'seleccion');
    expect(sel).toHaveLength(10);
    expect(sel.every((p) => p.opciones.length === 4 && p.obligatoria)).toBe(true);
    expect(sel[0].texto.startsWith('Según el reglamento')).toBe(true);
    // La lista desplegable (pregunta 4) se importó con sus 4 opciones.
    expect(sel[3].opciones[3]).toMatch(/^Reportarlo inmediatamente al jefe directo/);
    // La letra escrita a mano en una opción ("d. Solo está prohibido…") se quitó.
    expect(sel[1].opciones.every((o) => !/^[a-d]\./.test(o))).toBe(true);
  });

  it('lo que no se puede importar queda como advertencia y no entra', () => {
    const i = normalizarImportacion({
      titulo: 'T',
      variasPaginas: true,
      preguntas: [
        { titulo: 'Marque varias', tipo: 'multiple', obligatoria: true, opciones: ['a', 'b'] },
        { titulo: 'Califique', tipo: 'otro', obligatoria: false, opciones: [] },
        { titulo: '', tipo: 'texto', obligatoria: true, opciones: [] },
        { titulo: 'Sin opciones', tipo: 'seleccion', obligatoria: true, opciones: [] },
        { titulo: 'Esta sí', tipo: 'texto_largo', obligatoria: false, opciones: [] },
      ],
    });
    expect(i.preguntas.map((p) => p.texto)).toEqual(['Esta sí']);
    expect(i.advertencias).toHaveLength(5);
    expect(i.advertencias[0]).toMatch(/varias páginas/);
    expect(i.advertencias.join(' ')).toMatch(/selección múltiple/);
  });

  it('acota lo que viene del servicio: recorta, quita repetidas y caracteres de control', () => {
    const i = normalizarImportacion({
      titulo: 'T\u0000\u0007ítulo  \n  largo',
      descripcion: 'x'.repeat(5000),
      preguntas: [
        { titulo: 'P'.repeat(900), tipo: 'seleccion', obligatoria: true, opciones: ['a', 'a', 'b', 'O'.repeat(900), '  ', 'c'] },
        ...Array.from({ length: 250 }, (_, k) => ({ titulo: 'Q' + k, tipo: 'texto', obligatoria: false, opciones: [] })),
      ],
    });
    expect(i.titulo).toBe('T ítulo largo');
    expect(i.descripcion).toHaveLength(4000);
    expect(i.preguntas).toHaveLength(200);
    expect(i.preguntas[0].texto).toHaveLength(500);
    expect(i.preguntas[0].opciones).toEqual(['a', 'b', 'O'.repeat(500), 'c']);
    expect(i.advertencias.join(' ')).toMatch(/primeras 200 preguntas/);
  });

  it('con basura no lanza: devuelve una importación vacía', () => {
    for (const x of [null, undefined, 'texto', 42, [], { preguntas: 'no' }, { preguntas: [null, 7, 'x'] }]) {
      const i = normalizarImportacion(x);
      expect(i.preguntas).toEqual([]);
      expect(typeof i.titulo).toBe('string');
    }
  });

  it('un tipo desconocido es "otro"; texto/fecha no llevan opciones', () => {
    const i = normalizarImportacion({ preguntas: [{ titulo: 'Fecha', tipo: 'fecha', opciones: ['no'] }, { titulo: 'Raro', tipo: 'xyz' }] });
    expect(i.preguntas).toEqual([{ texto: 'Fecha', obligatoria: false, tipo: 'fecha', opciones: [] }]);
    expect(i.advertencias).toHaveLength(1);
  });
});
