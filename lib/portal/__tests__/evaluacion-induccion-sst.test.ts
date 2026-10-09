import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { calificar, definicionPublica, validarDefinicion } from '../formulario';

// La evaluación de INDUCCIÓN ORGANIZACIONAL - SST que pidió Cristian (2026-10-09),
// tal como se siembra en PRUEBAS: BORRADOR hasta que él confirme las correctas.

const RAIZ = path.join(__dirname, '..', '..', '..');
const JSON_DEF = readFileSync(path.join(RAIZ, 'lib/portal/formularios/eva-induccion-sst-2025.json'), 'utf8');
const SQL = readFileSync(path.join(RAIZ, 'prisma/manual/2026-10-09-portal-pruebas-agregar-evaluacion-induccion.sql'), 'utf8');

describe('evaluación de Inducción Organizacional y SST', () => {
  const r = validarDefinicion(JSON.parse(JSON_DEF));

  it('es una definición válida: borrador, 10 preguntas de 10 puntos, nota mínima 80', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.definicion;
    expect(d).toMatchObject({ tipo: 'evaluacion', notaMinima: 80, borrador: true });
    const calificadas = d.preguntas.filter((p) => p.puntos !== undefined);
    expect(calificadas).toHaveLength(10);
    expect(calificadas.every((p) => p.puntos === 10)).toBe(true);
    expect(d.preguntas.slice(0, 2).map((p) => p.id)).toEqual(['dato_nombre', 'dato_cedula']);
  });

  it('las preguntas 7 y 10 siguen SIN respuesta correcta (las define Cristian); las demás, propuestas', () => {
    if (!r.ok) throw new Error('inválida');
    const por = Object.fromEntries(r.definicion.preguntas.map((p) => [p.id, p.correcta]));
    expect(por.q7).toBeUndefined();
    expect(por.q10).toBeUndefined();
    for (const id of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q8', 'q9']) expect(por[id]).toBeDefined();
  });

  it('al publicarla (quitar el borrador y marcar 7 y 10) sería válida y calificaría', () => {
    if (!r.ok) throw new Error('inválida');
    const completa = JSON.parse(JSON_DEF);
    delete completa.borrador;
    for (const p of completa.preguntas) if (p.id === 'q7' || p.id === 'q10') p.correcta = 0;
    const v = validarDefinicion(completa);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const buenas = Object.fromEntries(v.definicion.preguntas.filter((p) => p.correcta !== undefined).map((p) => [p.id, p.opciones![p.correcta!]]));
    expect(calificar(v.definicion, buenas)).toMatchObject({ porcentaje: 100, aprobado: true });
    expect(JSON.stringify(definicionPublica(v.definicion))).not.toMatch(/"correcta":/);
  });

  it('el SQL de PRUEBAS siembra exactamente la misma definición', () => {
    const m = /DECLARE @definicion NVARCHAR\(MAX\) = N'([\s\S]*?)';\n/.exec(SQL);
    expect(m).not.toBeNull();
    const delSql = JSON.parse(m![1].replace(/''/g, "'"));
    expect(delSql).toEqual(JSON.parse(JSON_DEF));
  });

  it('el SQL se niega a correr fuera de PRUEBAS y exige la migración', () => {
    expect(SQL).toContain("IF DB_NAME() <> N'KRONOSDB_PRUEBAS'");
    expect(SQL).toContain('portal_formulario_intento');
  });
});
