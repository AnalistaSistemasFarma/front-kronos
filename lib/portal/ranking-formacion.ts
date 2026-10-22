/**
 * FORMACIÓN — TOP 10 DE ESTUDIANTES (Cristian Baldión, 2026-10-16).
 *
 * «Los mejores estudiantes: los que sacan las mejores notas y van completando más cursos; el primero con medalla de oro, el segundo
 * de plata y el tercero de bronce.»
 *
 * CRITERIO (público y simple, para que nadie tenga que adivinar por qué quedó donde quedó):
 *   1. CURSOS COMPLETADOS (más es mejor): los que tienen CERTIFICADO emitido, de cursos publicados. El certificado se emite al llegar
 *      al 100 % y se borra al «Restablecer» un curso, así que el ranking sigue lo que de verdad está completo.
 *   2. NOTA PROMEDIO (más es mejor): promedio, en %, de la MEJOR nota aprobada de cada evaluación que la persona presentó. Quien no
 *      presentó evaluaciones queda sin nota («—») y va después de quien sí la tiene, a igual número de cursos.
 *   3. DESEMPATE: quien llegó antes a su último curso completado. Así no hay empates y las medallas son inequívocas.
 * Solo entra quien completó al menos un curso. No se cuentan formadores ni administradores (marcan y restablecen cursos, y sus
 * propias pruebas distorsionarían la tabla).
 *
 * PRIVACIDAD (Cristian, 2026-10-16: «solo el nombre del estudiante»): lo que sale hacia el navegador es el PUESTO y el NOMBRE. Los cursos
 * completados y la nota SOLO deciden el orden: no se muestran ni viajan. Nunca el correo, la cédula ni el detalle de las evaluaciones.
 * Este archivo es PURO (sin red ni base).
 */

export const TOPE_TOP = 10;

export interface CertificadoRanking {
  correo: string;
  nombre: string;
  cursoId: number;
  emitidoEl: Date;
}

export interface NotaRanking {
  correo: string;
  materialId: number;
  /** Mejor porcentaje aprobado de esa persona en esa evaluación. */
  porcentaje: number;
}

export interface EntradaRanking {
  correo: string;
  nombre: string;
  cursos: number;
  /** Promedio en %, con un decimal; null si no presentó ninguna evaluación. */
  nota: number | null;
  /** Fecha (ms) de su último curso completado: sirve de desempate. */
  ultima: number;
}

export interface FilaTop {
  puesto: number;
  nombre: string;
  /** La fila es de quien está mirando la tabla (se resalta; el correo nunca viaja). */
  esUsted: boolean;
}

export interface VistaRanking {
  top: FilaTop[];
  /** Cuántas personas tienen al menos un curso completado. */
  total: number;
  /** Quien mira, si está FUERA del top; si está dentro, null (ya sale resaltado). */
  usted: FilaTop | null;
}

const minusculas = (c: string) => c.trim().toLowerCase();
const redondear1 = (n: number) => Math.round(n * 10) / 10;
const limpiarNombre = (n: string) => n.replace(/\s+/g, ' ').trim().slice(0, 80);

/** Todas las personas con al menos un curso completado, de la mejor a la peor. */
export function armarRanking(params: {
  certificados: CertificadoRanking[];
  notas: NotaRanking[];
  /** Correos que no entran (formadores y administradores). */
  excluidos?: Iterable<string>;
}): EntradaRanking[] {
  const excluidos = new Set([...(params.excluidos ?? [])].map(minusculas));
  const porPersona = new Map<string, { nombre: string; nombreEl: number; cursos: Set<number>; ultima: number }>();
  for (const c of params.certificados) {
    const correo = minusculas(c.correo);
    if (!correo || excluidos.has(correo)) continue;
    const t = c.emitidoEl.getTime();
    const p = porPersona.get(correo) ?? { nombre: '', nombreEl: -Infinity, cursos: new Set<number>(), ultima: 0 };
    p.cursos.add(c.cursoId);
    if (t > p.ultima) p.ultima = t;
    // El nombre es el del certificado más reciente.
    if (t >= p.nombreEl && limpiarNombre(c.nombre)) {
      p.nombre = limpiarNombre(c.nombre);
      p.nombreEl = t;
    }
    porPersona.set(correo, p);
  }

  // Mejor nota por persona y evaluación (por si llegaran repetidas), luego el promedio.
  const mejor = new Map<string, Map<number, number>>();
  for (const n of params.notas) {
    const correo = minusculas(n.correo);
    if (!porPersona.has(correo) || !Number.isFinite(n.porcentaje)) continue;
    const m = mejor.get(correo) ?? new Map<number, number>();
    m.set(n.materialId, Math.max(m.get(n.materialId) ?? -Infinity, Math.min(100, Math.max(0, n.porcentaje))));
    mejor.set(correo, m);
  }

  const entradas: EntradaRanking[] = [...porPersona].map(([correo, p]) => {
    const notas = [...(mejor.get(correo)?.values() ?? [])];
    return {
      correo,
      nombre: p.nombre || 'Estudiante',
      cursos: p.cursos.size,
      nota: notas.length ? redondear1(notas.reduce((a, b) => a + b, 0) / notas.length) : null,
      ultima: p.ultima,
    };
  });

  return entradas.sort(
    (a, b) =>
      b.cursos - a.cursos ||
      (b.nota ?? -1) - (a.nota ?? -1) ||
      a.ultima - b.ultima ||
      a.nombre.localeCompare(b.nombre, 'es') ||
      a.correo.localeCompare(b.correo)
  );
}

/** Lo que se le entrega a quien mira: el top y, si no está en él, su propio puesto. Sin correos. */
export function vistaPublica(ranking: EntradaRanking[], correoUsuario: string, tope = TOPE_TOP): VistaRanking {
  const yo = minusculas(correoUsuario);
  const fila = (e: EntradaRanking, i: number): FilaTop => ({ puesto: i + 1, nombre: e.nombre, esUsted: e.correo === yo });
  const top = ranking.slice(0, tope).map(fila);
  const idx = ranking.findIndex((e) => e.correo === yo);
  return { top, total: ranking.length, usted: idx >= tope ? fila(ranking[idx], idx) : null };
}

/** «Oro», «Plata» o «Bronce» para los tres primeros puestos; null para el resto. */
export function medallaDelPuesto(puesto: number): 'oro' | 'plata' | 'bronce' | null {
  return puesto === 1 ? 'oro' : puesto === 2 ? 'plata' : puesto === 3 ? 'bronce' : null;
}
