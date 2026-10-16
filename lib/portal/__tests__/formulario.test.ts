import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MENSAJE_OBLIGATORIA,
  celdaSegura,
  columnasDeRespuestas,
  textoDeRespuesta,
  validarDefinicion,
  validarRespuestas,
  valoresIniciales,
  type DefinicionFormulario,
} from '../formulario';

// Formación — formulario propio (Cristian Baldión, 2026-10-08).

const RAIZ = path.join(__dirname, '..', '..', '..');
const SST = JSON.parse(readFileSync(path.join(RAIZ, 'lib/portal/formularios/sst-01-fr-001.json'), 'utf8'));

function definicionSst(): DefinicionFormulario {
  const r = validarDefinicion(SST);
  if (!r.ok) throw new Error(r.errores.join('\n'));
  return r.definicion;
}

/** Respuestas completas y válidas del SST (solo obligatorias). */
function respuestasCompletas(d: DefinicionFormulario): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const p of d.preguntas) {
    if (!p.obligatoria) continue;
    if (p.tipo === 'fecha') r[p.id] = '1990-05-17';
    else if (p.tipo === 'seleccion') r[p.id] = p.opciones![0];
    else if (p.tipo === 'si_no') r[p.id] = 'No';
    else r[p.id] = 'Respuesta';
  }
  return r;
}

describe('definición SST-01-FR-001 PERFIL SOCIODEMOGRÁFICO SST (fiel a Microsoft Forms)', () => {
  const d = definicionSst();
  const p = (n: number) => d.preguntas[n - 1];

  it('es válida, con 40 preguntas, datos sensibles y autorización pendiente de validación', () => {
    expect(d.codigo).toBe('SST-01-FR-001');
    expect(d.titulo).toBe('SST-01-FR-001 PERFIL SOCIODEMOGRÁFICO SST');
    expect(d.preguntas).toHaveLength(40);
    expect(d.datosSensibles).toBe(true);
    expect(d.autorizacion?.pendienteValidacion).toBe(true);
    expect(d.autorizacion?.texto.join(' ')).toMatch(/Ley 1581 de 2012/);
  });

  it('tipos por posición, como el formulario original', () => {
    const tipos = d.preguntas.map((q) => q.tipo);
    const esperado: Record<number, string> = {};
    for (const n of [1, 2, 3, 4, 8, 14, 15, 16, 18, 19, 21, 22, 23, 24, 26, 28, 31, 33, 35, 36, 38, 40]) esperado[n] = 'texto';
    for (const n of [5, 6, 9, 10, 11, 12, 13, 17, 20, 27, 29, 30, 32, 34, 37, 39]) esperado[n] = 'seleccion';
    esperado[7] = 'fecha';
    esperado[25] = 'si_no';
    expect(tipos).toEqual(Array.from({ length: 40 }, (_, i) => esperado[i + 1]));
  });

  it('opcionales: 14, 22, 23, 24, 26, 31, 33, 35, 36 y 38; las demás obligatorias', () => {
    const opcionales = d.preguntas.flatMap((q, i) => (q.obligatoria ? [] : [i + 1]));
    expect(opcionales).toEqual([14, 22, 23, 24, 26, 31, 33, 35, 36, 38]);
  });

  it('"Otra respuesta" solo en 6, 11 y 12', () => {
    expect(d.preguntas.flatMap((q, i) => (q.permiteOtra ? [i + 1] : []))).toEqual([6, 11, 12]);
  });

  it('textos y opciones tal cual', () => {
    expect(p(1).texto).toBe('CORREO');
    expect(p(1).prellenar).toBe('correo');
    expect(p(2).prellenar).toBe('nombre');
    expect(p(6).opciones).toEqual(['HOMBRE', 'MUJER', 'PERSONA NO BINARIA', 'PREFIERO NO DECIR']);
    expect(p(17).opciones).toEqual(['ESTRATO 1', 'ESTRATO 2', 'ESTRATO 3', 'ESTRATO 4', 'ESTRATO 5', 'ESTRATO 6']);
    expect(p(20).opciones).toEqual(['BACHILLERATO', 'TECNICO', 'TECNOLOGO', 'PREGRADO', 'POSGRADO', 'MAESTRIA', 'DOCTORADO']);
    expect(p(39).opciones).toEqual(['1- 3 MESES', '4 - 5 MESES', 'MAYOR DE 6 MESES', 'NO CONSULTÓ']);
    expect(p(40).texto).toBe('INFORMACIÓN EN CASO DE EMERGENCIA(NOMBRE,CELULAR, PARENTESCO)');
  });

  it('la migración siembra EXACTAMENTE esta definición', () => {
    const sql = readFileSync(
      path.join(RAIZ, 'prisma/migrations/20261008160000_portal_formacion_formulario_propio/migration.sql'),
      'utf8'
    );
    const bloque = /-- <SIEMBRA-SST>([\s\S]*?)-- <\/SIEMBRA-SST>/.exec(sql)?.[1] ?? '';
    const trozos = [...bloque.matchAll(/CAST\(N'((?:[^']|'')*)' AS NVARCHAR\(MAX\)\)/g)].map((m) => m[1].replace(/''/g, "'"));
    expect(trozos.length).toBeGreaterThan(0);
    expect(JSON.parse(trozos.join(''))).toEqual(SST);
  });
});

describe('validarDefinicion', () => {
  it('rechaza ids repetidos, tipos desconocidos y selección sin opciones', () => {
    const r = validarDefinicion({
      formato: 1,
      codigo: 'X',
      titulo: 'X',
      preguntas: [
        { id: 'a', texto: 'A', tipo: 'texto' },
        { id: 'a', texto: 'B', tipo: 'texto' },
        { id: 'c', texto: 'C', tipo: 'casillas' },
        { id: 'd', texto: 'D', tipo: 'seleccion', opciones: [] },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores).toHaveLength(3);
  });

  it('datos sensibles sin autorización: no se acepta (Ley 1581)', () => {
    const r = validarDefinicion({ formato: 1, codigo: 'X', titulo: 'X', datosSensibles: true, preguntas: [{ id: 'a', texto: 'A', tipo: 'texto' }] });
    expect(r.ok).toBe(false);
  });

  it('descarta campos desconocidos', () => {
    const r = validarDefinicion({ formato: 1, codigo: 'X', titulo: 'X', extra: 1, preguntas: [{ id: 'a', texto: 'A', tipo: 'numero', raro: true }] });
    expect(r.ok && r.definicion).toEqual({ formato: 1, codigo: 'X', titulo: 'X', preguntas: [{ id: 'a', texto: 'A', tipo: 'numero', obligatoria: false }] });
  });
});

describe('validarRespuestas — obligatorias y tipos', () => {
  const d = definicionSst();

  it('completo: pasa y normaliza (recorta, quita opcionales vacías y preguntas desconocidas)', () => {
    const r = validarRespuestas(d, { ...respuestasCompletas(d), p02: '  Pérez Ana  ', p14: '   ', zzz: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.respuestas.p02).toBe('Pérez Ana');
      expect(r.respuestas).not.toHaveProperty('p14');
      expect(r.respuestas).not.toHaveProperty('zzz');
    }
  });

  it('vacío: un error por cada obligatoria, en el orden del formulario', () => {
    const r = validarRespuestas(d, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores).toHaveLength(30);
      expect(r.errores[0]).toEqual({ id: 'p01', mensaje: MENSAJE_OBLIGATORIA });
      expect(r.errores.map((e) => e.id)).not.toContain('p14');
    }
  });

  it('falta UNA obligatoria (la 19, RH): solo esa', () => {
    const resp = respuestasCompletas(d);
    delete resp.p19;
    const r = validarRespuestas(d, resp);
    expect(!r.ok && r.errores).toEqual([{ id: 'p19', mensaje: MENSAJE_OBLIGATORIA }]);
  });

  it('"Otra" con texto vale; "Otra" vacía o en una pregunta sin "Otra" no', () => {
    const base = respuestasCompletas(d);
    expect(validarRespuestas(d, { ...base, p06: { otra: 'Mujer trans' } }).ok).toBe(true);
    const vacia = validarRespuestas(d, { ...base, p06: { otra: '  ' } });
    expect(!vacia.ok && vacia.errores[0].id).toBe('p06');
    const sinOtra = validarRespuestas(d, { ...base, p05: { otra: 'X' } });
    expect(!sinOtra.ok && sinOtra.errores[0]).toEqual({ id: 'p05', mensaje: 'Respuesta no válida.' });
  });

  it('opción inexistente, fecha imposible y Sí/No fuera de lista: error', () => {
    const base = respuestasCompletas(d);
    const r = validarRespuestas(d, { ...base, p17: 'ESTRATO 9', p07: '1990-02-30', p25: 'Tal vez' });
    expect(!r.ok && r.errores.map((e) => e.id)).toEqual(['p07', 'p17', 'p25']);
  });

  it('número: acepta enteros y decimales con coma o punto', () => {
    const def: DefinicionFormulario = { formato: 1, codigo: 'N', titulo: 'N', preguntas: [{ id: 'n', texto: 'N', tipo: 'numero', obligatoria: true }] };
    for (const ok of ['30', '1,5', '-2.25']) expect(validarRespuestas(def, { n: ok }).ok).toBe(true);
    for (const mal of ['1e3', 'treinta', '1.2.3', '.5']) expect(validarRespuestas(def, { n: mal }).ok).toBe(false);
  });
});

describe('utilidades', () => {
  const d = definicionSst();
  it('prellena correo y nombre', () => {
    expect(valoresIniciales(d, { correo: 'a@b.co', nombre: 'Ana' })).toEqual({ p01: 'a@b.co', p02: 'Ana' });
  });
  it('texto de respuesta y "Otra"', () => {
    expect(textoDeRespuesta({ otra: 'Sorda' })).toBe('Otra: Sorda');
    expect(textoDeRespuesta(undefined)).toBe('');
  });
  it('neutraliza fórmulas en Excel', () => {
    expect(celdaSegura('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(celdaSegura('+57 300')).toBe(`'+57 300`);
    expect(celdaSegura('O+')).toBe('O+');
  });
  it('columnas: vigente en orden y al final las de versiones anteriores', () => {
    const vieja: DefinicionFormulario = { ...d, preguntas: [...d.preguntas, { id: 'p99', texto: 'VIEJA', tipo: 'texto', obligatoria: false }] };
    const cols = columnasDeRespuestas(d, [vieja]);
    expect(cols).toHaveLength(41);
    expect(cols[40]).toEqual({ id: 'p99', texto: 'VIEJA (versión anterior)' });
  });
});
