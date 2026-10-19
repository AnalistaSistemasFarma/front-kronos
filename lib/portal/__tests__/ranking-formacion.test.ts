import { describe, expect, it } from 'vitest';
import { TOPE_TOP, armarRanking, medallaDelPuesto, textoNota, vistaPublica, type CertificadoRanking, type NotaRanking } from '../ranking-formacion';

// Top 10 de estudiantes (Cristian Baldión, 2026-10-16). Personas inventadas.

const f = (dia: number) => new Date(`2026-10-${String(dia).padStart(2, '0')}T12:00:00Z`);
const cert = (correo: string, cursoId: number, dia: number, nombre = correo.split('@')[0].toUpperCase()): CertificadoRanking => ({ correo, nombre, cursoId, emitidoEl: f(dia) });
const nota = (correo: string, materialId: number, porcentaje: number): NotaRanking => ({ correo, materialId, porcentaje });

describe('armarRanking', () => {
  it('sin certificados no hay nadie, aunque haya notas', () => {
    expect(armarRanking({ certificados: [], notas: [nota('a@x.com', 1, 100)] })).toEqual([]);
  });

  it('primero más cursos completados; a igual número, mejor nota promedio', () => {
    const r = armarRanking({
      certificados: [cert('tres@x.com', 1, 1), cert('tres@x.com', 2, 2), cert('tres@x.com', 3, 3), cert('dos@x.com', 1, 1), cert('dos@x.com', 2, 2), cert('dosb@x.com', 1, 1), cert('dosb@x.com', 2, 2)],
      notas: [nota('tres@x.com', 10, 60), nota('dos@x.com', 10, 95), nota('dosb@x.com', 10, 80)],
    });
    expect(r.map((e) => e.correo)).toEqual(['tres@x.com', 'dos@x.com', 'dosb@x.com']);
    expect(r.map((e) => e.cursos)).toEqual([3, 2, 2]);
  });

  it('un curso con mala nota no le gana a dos cursos con nota discreta (el criterio es cursos primero)', () => {
    const r = armarRanking({ certificados: [cert('a@x.com', 1, 1), cert('b@x.com', 1, 1), cert('b@x.com', 2, 2)], notas: [nota('a@x.com', 1, 100), nota('b@x.com', 1, 70)] });
    expect(r[0].correo).toBe('b@x.com');
  });

  it('la nota es el promedio de la MEJOR nota aprobada de cada evaluación (no cuenta intentos repetidos dos veces)', () => {
    const r = armarRanking({
      certificados: [cert('a@x.com', 1, 1)],
      notas: [nota('a@x.com', 10, 70), nota('a@x.com', 10, 90), nota('a@x.com', 11, 100)],
    });
    expect(r[0].nota).toBe(95); // (90 + 100) / 2
  });

  it('un decimal, notas fuera de 0-100 se acotan y las no numéricas se ignoran', () => {
    const r = armarRanking({ certificados: [cert('a@x.com', 1, 1)], notas: [nota('a@x.com', 1, 91.26), nota('a@x.com', 2, 140), nota('a@x.com', 3, Number.NaN)] });
    expect(r[0].nota).toBe(95.6); // (91,26 + 100) / 2 = 95,63
  });

  it('quien no presentó evaluaciones queda sin nota y va después de quien sí la tiene, a igual número de cursos', () => {
    const r = armarRanking({ certificados: [cert('sin@x.com', 1, 1), cert('con@x.com', 1, 5)], notas: [nota('con@x.com', 1, 10)] });
    expect(r.map((e) => [e.correo, e.nota])).toEqual([['con@x.com', 10], ['sin@x.com', null]]);
  });

  it('desempate: quien llegó antes a su último curso; y sin empates posibles se ordena por nombre', () => {
    const r = armarRanking({ certificados: [cert('tarde@x.com', 1, 9), cert('pronto@x.com', 1, 2)], notas: [nota('tarde@x.com', 1, 90), nota('pronto@x.com', 1, 90)] });
    expect(r.map((e) => e.correo)).toEqual(['pronto@x.com', 'tarde@x.com']);
    const mismo = armarRanking({ certificados: [cert('b@x.com', 1, 2, 'Beatriz'), cert('a@x.com', 1, 2, 'Ana')], notas: [] });
    expect(mismo.map((e) => e.nombre)).toEqual(['Ana', 'Beatriz']);
  });

  it('excluye a formadores y administradores sin importar mayúsculas, y no cuentan en el total', () => {
    const r = armarRanking({
      certificados: [cert('Jefe@GSSLATAM.com', 1, 1), cert('jefe@gsslatam.com', 2, 2), cert('est@x.com', 1, 3)],
      notas: [nota('jefe@gsslatam.com', 1, 100)],
      excluidos: ['JEFE@gsslatam.com'],
    });
    expect(r.map((e) => e.correo)).toEqual(['est@x.com']);
  });

  it('el mismo correo en mayúsculas y minúsculas es la misma persona; el mismo curso dos veces cuenta una', () => {
    const r = armarRanking({ certificados: [cert('Ana@x.com', 1, 1), cert('ana@x.com', 1, 2), cert('ANA@x.com', 2, 3)], notas: [] });
    expect(r).toHaveLength(1);
    expect(r[0].cursos).toBe(2);
  });

  it('el nombre es el del certificado más reciente; sin nombre, «Estudiante»; limpia espacios', () => {
    const r = armarRanking({ certificados: [cert('a@x.com', 1, 1, 'Ana Vieja'), cert('a@x.com', 2, 5, '  Ana   María  Gómez '), cert('b@x.com', 1, 1, '   ')], notas: [] });
    expect(r.find((e) => e.correo === 'a@x.com')!.nombre).toBe('Ana María Gómez');
    expect(r.find((e) => e.correo === 'b@x.com')!.nombre).toBe('Estudiante');
  });
});

describe('vistaPublica', () => {
  const muchos = armarRanking({
    certificados: Array.from({ length: 14 }, (_, i) => cert(`p${String(i + 1).padStart(2, '0')}@x.com`, 1, i + 1, `Persona ${i + 1}`)),
    notas: Array.from({ length: 14 }, (_, i) => nota(`p${String(i + 1).padStart(2, '0')}@x.com`, 1, 100 - i)),
  });

  it('entrega los 10 primeros con su puesto, y el total', () => {
    const v = vistaPublica(muchos, 'otra@x.com');
    expect(TOPE_TOP).toBe(10);
    expect(v.top).toHaveLength(10);
    expect(v.top.map((x) => x.puesto)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(v.total).toBe(14);
    expect(v.usted).toBeNull();
    expect(v.top.every((x) => !x.esUsted)).toBe(true);
  });

  it('marca la fila de quien mira si está en el top (sin mayúsculas)', () => {
    const v = vistaPublica(muchos, 'P03@X.com');
    expect(v.top.filter((x) => x.esUsted).map((x) => x.puesto)).toEqual([3]);
    expect(v.usted).toBeNull();
  });

  it('si quien mira está FUERA del top, devuelve su propio puesto aparte', () => {
    const v = vistaPublica(muchos, 'p13@x.com');
    expect(v.top.some((x) => x.esUsted)).toBe(false);
    expect(v.usted).toEqual({ puesto: 13, nombre: 'Persona 13', cursos: 1, nota: 88, esUsted: true });
  });

  it('NUNCA entrega correos, ni de las filas ni de «usted»', () => {
    const texto = JSON.stringify(vistaPublica(muchos, 'p13@x.com'));
    expect(texto).not.toMatch(/@|correo/i);
    expect(Object.keys(vistaPublica(muchos, 'p01@x.com').top[0]).sort()).toEqual(['cursos', 'esUsted', 'nombre', 'nota', 'puesto']);
  });

  it('con menos de 10 personas entrega las que haya; sin nadie, vacío', () => {
    expect(vistaPublica(muchos.slice(0, 2), 'x@x.com').top).toHaveLength(2);
    expect(vistaPublica([], 'x@x.com')).toEqual({ top: [], total: 0, usted: null });
  });
});

describe('medallaDelPuesto y textoNota', () => {
  it('oro, plata y bronce para los tres primeros; nada para el resto', () => {
    expect([1, 2, 3, 4, 10].map(medallaDelPuesto)).toEqual(['oro', 'plata', 'bronce', null, null]);
  });
  it('la nota con coma decimal y «—» si no hay', () => {
    expect(textoNota(92)).toBe('92 %');
    expect(textoNota(92.5)).toBe('92,5 %');
    expect(textoNota(0)).toBe('0 %');
    expect(textoNota(null)).toBe('—');
  });
});
