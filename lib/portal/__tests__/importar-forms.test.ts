import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizarImportacion, sinMarcadoresDeOpciones, sinNumeracionDePreguntas, validarEnlaceForms } from '../importar-forms';

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

describe('marcadores de lista (sinNumeracionDePreguntas / sinMarcadoresDeOpciones)', () => {
  it('quita la numeración del autor solo si las preguntas numeradas van 1, 2, 3…', () => {
    expect(sinNumeracionDePreguntas(['Nombre Completo', '1. Según el reglamento', '2) ¿Cuál es?', '3.¿Cuáles son?'])).toEqual([
      'Nombre Completo',
      'Según el reglamento',
      '¿Cuál es?',
      '¿Cuáles son?',
    ]);
    // Una sola pregunta numerada, o números fuera de secuencia: no se toca nada.
    expect(sinNumeracionDePreguntas(['1. Única', 'Otra'])).toEqual(['1. Única', 'Otra']);
    expect(sinNumeracionDePreguntas(['2. Uno', '5. Dos'])).toEqual(['2. Uno', '5. Dos']);
    expect(sinNumeracionDePreguntas(['2026 fue un año', 'Nombre'])).toEqual(['2026 fue un año', 'Nombre']);
  });

  it('nunca toca decimales ni dosis en los enunciados (farmacia)', () => {
    const t = ['1.5 mg de dexametasona: ¿cuál es la vía?', '0.9 % NaCl: ¿cuál es su osmolaridad?', '2.5 ml cada 8 horas'];
    expect(sinNumeracionDePreguntas(t)).toEqual(t);
    // Mezclado con preguntas numeradas: las numeradas se limpian, el decimal queda intacto.
    expect(sinNumeracionDePreguntas(['1. ¿Qué es?', '1.5 mg es la dosis', '2. ¿Y esto?'])).toEqual(['¿Qué es?', '1.5 mg es la dosis', '¿Y esto?']);
  });

  it('opciones con letra en secuencia en TODAS: se quitan ("a) Sí / b) No")', () => {
    expect(sinMarcadoresDeOpciones(['a) Sí', 'b) No'])).toEqual(['Sí', 'No']);
    expect(sinMarcadoresDeOpciones(['A. Primera', 'B. Segunda', 'C. Tercera'])).toEqual(['Primera', 'Segunda', 'Tercera']);
    expect(sinMarcadoresDeOpciones(['1. Uno', '2) Dos', '3. Tres'])).toEqual(['Uno', 'Dos', 'Tres']);
  });

  it('abreviaturas y nombres de laboratorio no se tocan ("E. coli", "B. Braun")', () => {
    const micro = ['E. coli', 'S. aureus', 'P. aeruginosa', 'K. pneumoniae'];
    expect(sinMarcadoresDeOpciones(micro)).toEqual(micro);
    const labs = ['B. Braun', 'Baxter', 'Fresenius Kabi'];
    expect(sinMarcadoresDeOpciones(labs)).toEqual(labs);
    // Una sola opción con "letra" (aunque coincida con su posición) no basta.
    const una = ['Solo está prohibido A', 'Está prohibido B', 'No está permitido C', 'd. Solo está prohibido D'];
    expect(sinMarcadoresDeOpciones(una)).toEqual(una);
    // Letras que no van en secuencia, o mezcla de mayúsculas y minúsculas: tampoco.
    expect(sinMarcadoresDeOpciones(['b. Uno', 'c. Dos'])).toEqual(['b. Uno', 'c. Dos']);
    expect(sinMarcadoresDeOpciones(['a. Uno', 'B. Dos'])).toEqual(['a. Uno', 'B. Dos']);
  });

  it('decimales y concentraciones en las opciones no se tocan ("1.5 mg", "0.9 % NaCl")', () => {
    const dosis = ['1.5 mg', '2.5 mg', '3.5 mg'];
    expect(sinMarcadoresDeOpciones(dosis)).toEqual(dosis);
    const sol = ['0.9 % NaCl', '5 % dextrosa', 'Lactato de Ringer'];
    expect(sinMarcadoresDeOpciones(sol)).toEqual(sol);
    expect(sinMarcadoresDeOpciones(['1.5', '2.5'])).toEqual(['1.5', '2.5']);
  });

  it('normalizarImportacion aplica las mismas reglas de punta a punta', () => {
    const i = normalizarImportacion({
      preguntas: [
        { titulo: '1. ¿Qué microorganismo es gramnegativo?', tipo: 'seleccion', obligatoria: true, opciones: ['E. coli', 'S. aureus', 'B. subtilis'] },
        { titulo: '2. ¿Cuál es la concentración de la solución salina normal?', tipo: 'seleccion', obligatoria: true, opciones: ['0.9 % NaCl', '1.5 mg', '3 % NaCl'] },
        { titulo: '3. ¿Acepta?', tipo: 'seleccion', obligatoria: true, opciones: ['a) Sí', 'b) No'] },
        { titulo: '4. Proveedor', tipo: 'seleccion', obligatoria: false, opciones: ['Baxter', 'B. Braun'] },
      ],
    });
    expect(i.preguntas.map((p) => p.texto)).toEqual([
      '¿Qué microorganismo es gramnegativo?',
      '¿Cuál es la concentración de la solución salina normal?',
      '¿Acepta?',
      'Proveedor',
    ]);
    expect(i.preguntas[0].opciones).toEqual(['E. coli', 'S. aureus', 'B. subtilis']);
    expect(i.preguntas[1].opciones).toEqual(['0.9 % NaCl', '1.5 mg', '3 % NaCl']);
    expect(i.preguntas[2].opciones).toEqual(['Sí', 'No']);
    // "B. Braun" en la segunda posición coincide con la letra «b»: no se quita, pero se avisa para revisar.
    expect(i.preguntas[3].opciones).toEqual(['Baxter', 'B. Braun']);
    expect(i.advertencias.join(' ')).toMatch(/Pregunta 4: la opción «B\. Braun» parece traer una letra/);
  });
});

describe('normalizarImportacion', () => {
  it('el Forms real de Inducción: 12 preguntas, 10 de selección con 4 opciones, sin numeración del autor', () => {
    const i = normalizarImportacion(CRUDO);
    expect(i.titulo).toBe('Evaluación Inducción Organizacional y SST Farmalógica SA 2025');
    expect(i.preguntas).toHaveLength(12);
    // Solo la cuarta opción de la pregunta 4 trae "d." escrita a mano: no se quita (las demás no la
    // traen), pero se avisa para que quien importa la revise.
    expect(i.advertencias).toHaveLength(1);
    expect(i.advertencias[0]).toMatch(/^Pregunta 4: la opción «d\. Solo está prohibido/);
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
    // La letra suelta ("d. Solo está prohibido…") se conserva: no es una lista en secuencia.
    expect(sel[1].opciones[3]).toMatch(/^d\. Solo está prohibido/);
  });

  it('lo que no se puede importar queda como advertencia y no entra', () => {
    const i = normalizarImportacion({
      titulo: 'T',
      variasPaginas: true,
      preguntas: [
        { titulo: 'Califique', tipo: 'otro', obligatoria: false, opciones: [] },
        { titulo: '', tipo: 'texto', obligatoria: true, opciones: [] },
        { titulo: 'Sin opciones', tipo: 'seleccion', obligatoria: true, opciones: [] },
        { titulo: 'Esta sí', tipo: 'texto_largo', obligatoria: false, opciones: [] },
      ],
    });
    expect(i.preguntas.map((p) => p.texto)).toEqual(['Esta sí']);
    expect(i.advertencias).toHaveLength(4);
    expect(i.advertencias[0]).toMatch(/varias páginas/);
    expect(i.advertencias.join(' ')).toMatch(/escala, clasificación u otro tipo/);
  });

  it('selección múltiple (Cristian, 2026-10-14): se importa con sus opciones, limpias y sin repetidas', () => {
    const i = normalizarImportacion({
      titulo: 'PTEE',
      preguntas: [
        { titulo: 'Seleccione 3 elementos de un PTEE', tipo: 'multiple', obligatoria: true, opciones: ['Uno', ' Dos ', 'Dos', 'Tres', ''] },
        { titulo: 'Sin opciones', tipo: 'multiple', obligatoria: true, opciones: [] },
      ],
    });
    expect(i.preguntas).toEqual([{ texto: 'Seleccione 3 elementos de un PTEE', obligatoria: true, tipo: 'seleccion_multiple', opciones: ['Uno', 'Dos', 'Tres'] }]);
    expect(i.advertencias).toHaveLength(1);
    expect(i.advertencias[0]).toMatch(/Sin opciones.*no tiene opciones/);
  });

  it('la lista desplegable se conserva como lista; en una selección múltiple la marca se ignora', () => {
    const i = normalizarImportacion({
      preguntas: [
        { titulo: 'Elija', tipo: 'seleccion', lista: true, obligatoria: false, opciones: ['a', 'b'] },
        { titulo: 'Botones', tipo: 'seleccion', obligatoria: false, opciones: ['a', 'b'] },
        { titulo: 'Varias', tipo: 'multiple', lista: true, obligatoria: false, opciones: ['a', 'b'] },
      ],
    });
    expect(i.preguntas.map((p) => [p.tipo, p.lista === true])).toEqual([
      ['seleccion', true],
      ['seleccion', false],
      ['seleccion_multiple', false],
    ]);
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
