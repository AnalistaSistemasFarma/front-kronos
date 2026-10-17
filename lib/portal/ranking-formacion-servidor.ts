/**
 * FORMACIÓN — carga del TOP 10 desde la base (Cristian Baldión, 2026-10-16). La regla está en `ranking-formacion.ts`.
 *
 * Dos consultas livianas: los certificados de cursos publicados y la MEJOR nota aprobada por persona y evaluación (agrupada en la base,
 * no se traen los intentos uno por uno). El resultado completo se recuerda un minuto en memoria: lo piden todas las personas que abren
 * Formación y no cambia a cada segundo. Nunca se entrega tal cual al navegador (trae correos): se pasa por `vistaPublica`.
 */
import { prisma } from '../prisma';
import { formadoresDePortal } from './config';
import { correosConMarcadoManual } from './permisos-formacion';
import { armarRanking, type EntradaRanking } from './ranking-formacion';

export const RANKING_CACHE_MS = 60_000;
let cache: { cuando: number; ranking: EntradaRanking[] } | null = null;

export function _reiniciarCacheRanking() {
  cache = null;
}

export async function cargarRanking(ahora: () => number = Date.now): Promise<EntradaRanking[]> {
  if (cache && ahora() - cache.cuando < RANKING_CACHE_MS) return cache.ranking;

  const [certificados, notas, administradores] = await Promise.all([
    prisma.portalCertificate.findMany({
      where: { course: { active: true } },
      select: { student_email: true, student_name: true, course_id: true, issued_at: true },
    }),
    prisma.portalFormularioIntento.groupBy({
      by: ['material_id', 'student_email'],
      where: { aprobado: true, material: { eliminado_at: null, course: { active: true } } },
      _max: { porcentaje: true },
    }),
    // Si el Excel de permisos no responde, queda la última lista buena (o vacía): el ranking no se cae por eso.
    correosConMarcadoManual(),
  ]);

  const ranking = armarRanking({
    certificados: certificados.map((c) => ({ correo: c.student_email, nombre: c.student_name, cursoId: c.course_id, emitidoEl: c.issued_at })),
    notas: notas.flatMap((n) => (n._max.porcentaje === null ? [] : [{ correo: n.student_email, materialId: n.material_id, porcentaje: n._max.porcentaje }])),
    excluidos: [...formadoresDePortal(), ...administradores],
  });
  cache = { cuando: ahora(), ranking };
  return ranking;
}
