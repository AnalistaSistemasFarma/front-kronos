import { prisma } from '../prisma';

/**
 * FORMACIÓN — ELIMINAR UN CURSO (Cristian Baldión, 2026-10-22).
 *
 * Borrado LÓGICO: marca `eliminado_at` / `eliminado_por` (quién y cuándo: la auditoría del módulo) y además lo pasa a
 * borrador (`active = false`), para que todos los filtros que ya miran `active` (lista del estudiante, materiales,
 * certificados nuevos, ranking) lo dejen fuera sin tocarlos. Las listas del formador filtran `eliminado_at: null`.
 *
 * CONSERVA inscripciones, progreso, respuestas, intentos y certificados: los certificados emitidos siguen
 * verificándose (guardan el título del curso congelado). NO toca SharePoint: la carpeta FORMACION es compartida entre
 * pruebas y producción, y los archivos se quedan donde están.
 */
export interface ResultadoEliminarCurso {
  titulo: string;
  inscritos: number;
  certificados: number;
}

/** Inscritos y certificados emitidos de un curso: lo que el formador ve antes de confirmar. */
export async function conteosDelCurso(courseId: number): Promise<{ inscritos: number; certificados: number }> {
  const [inscritos, certificados] = await Promise.all([
    prisma.portalCourseEnrollment.count({ where: { course_id: courseId } }),
    prisma.portalCertificate.count({ where: { course_id: courseId } }),
  ]);
  return { inscritos, certificados };
}

/** Devuelve null si el curso no existe o ya estaba eliminado. */
export async function eliminarCurso(courseId: number, correo: string): Promise<ResultadoEliminarCurso | null> {
  const curso = await prisma.portalCourse.findFirst({
    where: { id: courseId, eliminado_at: null },
    select: { id: true, title: true },
  });
  if (!curso) return null;

  // `updateMany` con la misma condición: si dos formadores eliminan a la vez, solo uno lo marca.
  const marcado = await prisma.portalCourse.updateMany({
    where: { id: courseId, eliminado_at: null },
    data: { eliminado_at: new Date(), eliminado_por: correo, active: false },
  });
  if (marcado.count === 0) return null;

  const { inscritos, certificados } = await conteosDelCurso(courseId);
  return { titulo: curso.title, inscritos, certificados };
}
