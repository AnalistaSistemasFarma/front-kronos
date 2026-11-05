import { describe, expect, it } from 'vitest';
import {
  consultarFilas,
  construirHoja,
  detectarFilaEncabezados,
  encabezadosUnicos,
  fichaHoja,
  hojaACsv,
  inferirTipo,
  leerCsv,
  nombreDesdeArchivo,
  normalizarCelda,
  resumenCambios,
  textoANumero,
  validarLibro,
} from '../matrices-rules';

/* Matrices integradas de Proyectos (2026-11-05). Reglas PURAS (lib/proyectos/matrices-rules.ts). */

describe('celdas y tipos', () => {
  it('normaliza fórmulas, texto enriquecido, fechas y vacíos', () => {
    expect(normalizarCelda({ formula: 'A1*2', result: 10 })).toBe(10);
    expect(normalizarCelda({ richText: [{ text: 'Hola ' }, { text: 'mundo' }] })).toBe('Hola mundo');
    expect(normalizarCelda(new Date('2026-11-05T00:00:00Z'))).toBe('2026-11-05');
    expect(normalizarCelda('  ')).toBeNull();
    expect(normalizarCelda({ error: '#DIV/0!' })).toBeNull();
  });

  it('lee números con separadores colombianos y gringos', () => {
    expect(textoANumero('1.234.567,89')).toBe(1234567.89);
    expect(textoANumero('1,234,567.89')).toBe(1234567.89);
    expect(textoANumero('12,5')).toBe(12.5);
    expect(textoANumero('1.500')).toBe(1500);
    expect(textoANumero('$ 2.000')).toBe(2000);
    expect(textoANumero('PO-123')).toBeNull();
  });

  it('infiere el tipo por mayoría', () => {
    expect(inferirTipo([1, 2, '3', null])).toBe('numero');
    expect(inferirTipo(['2026-01-01', '2026-02-01'])).toBe('fecha');
    expect(inferirTipo(['México', 'Chile', 3])).toBe('texto');
    expect(inferirTipo([null, null])).toBe('texto');
  });
});

describe('hojas', () => {
  const grilla = [
    ['Matriz de importaciones 2026', null, null],
    [null, null, null],
    ['País', 'Proveedor', 'Valor USD'],
    ['México', 'Acme', '1.200,50'],
    ['Chile', 'Beta', 800],
    [null, null, null],
  ];

  it('detecta la fila de encabezados aunque haya un título arriba', () => {
    expect(detectarFilaEncabezados(grilla)).toBe(2);
  });

  it('arma la hoja: encabezados, tipos, filas vacías fuera y números convertidos', () => {
    const r = construirHoja('Importaciones', grilla);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hoja.filaEncabezados).toBe(3);
    expect(r.hoja.columnas).toEqual([
      { nombre: 'País', tipo: 'texto' },
      { nombre: 'Proveedor', tipo: 'texto' },
      { nombre: 'Valor USD', tipo: 'numero' },
    ]);
    expect(r.hoja.filas).toEqual([
      ['México', 'Acme', 1200.5],
      ['Chile', 'Beta', 800],
    ]);
  });

  it('la persona puede fijar la fila de encabezados', () => {
    const r = construirHoja('X', grilla, 1);
    expect(r.ok && r.hoja.columnas[0].nombre).toBe('Matriz de importaciones 2026');
  });

  it('encabezados vacíos o repetidos quedan únicos', () => {
    expect(encabezadosUnicos(['Valor', null, 'valor', 'Valor'])).toEqual(['Valor', 'Columna 2', 'valor (2)', 'Valor (3)']);
  });

  it('valida que el libro tenga datos', () => {
    expect(validarLibro([{ nombre: 'H', filaEncabezados: 1, columnas: [], filas: [] }])).toMatch(/no tiene datos/);
  });

  it('nombre desde el archivo', () => {
    expect(nombreDesdeArchivo('Matriz_importaciones 2026.xlsx')).toBe('Matriz importaciones 2026');
  });
});

describe('CSV y ficha', () => {
  it('lee CSV con «;», comillas y saltos de línea dentro de un campo', () => {
    expect(leerCsv('﻿a;b\n"x;1";"di ""hola""\nmás"\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'di "hola"\nmás'],
    ]);
    expect(leerCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('escribe el CSV para el agente con «;» y comillas cuando hace falta', () => {
    const csv = hojaACsv(
      [
        { nombre: 'País', tipo: 'texto' },
        { nombre: 'Nota', tipo: 'texto' },
      ],
      [
        ['México', 'a;b'],
        ['Chile', null],
      ]
    );
    expect(csv).toBe('País;Nota\nMéxico;"a;b"\nChile;\n');
  });

  it('la ficha resume cada columna', () => {
    const f = fichaHoja(
      [
        { nombre: 'País', tipo: 'texto' },
        { nombre: 'Valor', tipo: 'numero' },
      ],
      [
        ['México', 10],
        ['Chile', 5.5],
        ['México', null],
      ]
    );
    expect(f[0]).toMatchObject({ distintos: 2, vacias: 0 });
    expect(f[1]).toMatchObject({ min: 5.5, max: 10, suma: 15.5, vacias: 1 });
  });
});

describe('grilla e historial', () => {
  const filas = [
    ['b', 2],
    ['a', 10],
    ['c', null],
  ] as (string | number | null)[][];

  it('busca, ordena (vacíos al final) y pagina', () => {
    expect(consultarFilas(filas, { ordenarPor: 1, descendente: true }).filas).toEqual([
      ['a', 10],
      ['b', 2],
      ['c', null],
    ]);
    expect(consultarFilas(filas, { q: 'A' }).total).toBe(1);
    expect(consultarFilas(filas, { porPagina: 10, pagina: 9 }).pagina).toBe(1);
  });

  it('resume lo que cambió entre versiones', () => {
    expect(resumenCambios(null, [{ nombre: 'H', filas: 3 }])).toBe('Primera versión: «H» 3 filas.');
    expect(
      resumenCambios(
        [
          { nombre: 'H', filas: 3 },
          { nombre: 'Old', filas: 1 },
        ],
        [
          { nombre: 'H', filas: 5 },
          { nombre: 'N', filas: 2 },
        ]
      )
    ).toBe('«H»: +2 filas (5 en total); hoja nueva «N» (2 filas); se quitó la hoja «Old».');
  });
});
