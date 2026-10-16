import { prisma } from '../prisma';

/**
 * FORMACIÓN — RESTABLECER UN CURSO PARA UN ESTUDIANTE (Cristian Baldión, 2026-10-14).
 *
 * El administrador del portal deja a un estudiante «como si no hubiera empezado» el curso, para que lo vuelva a hacer:
 *
 *   - BORRA el progreso de todos los materiales del curso (también los que luego se quitaron del curso).
 *   - BORRA sus respuestas de los formularios del curso (sin esto, un formulario o evaluación aprobados no se podrían
 *     volver a enviar: «ya lo envió»). Son datos personales: no se exportan ni se registran.
 *   - BORRA el certificado de ese curso (su código deja de verificarse y el curso puede volver a certificarse al
 *     completarse otra vez). El PDF ya archivado en SharePoint NO se toca.
 *
 * CONSERVA la inscripción y el HISTORIAL de intentos de las evaluaciones (`portal_formulario_intento`): quedan como
 * constancia de lo que ya hizo.
 *
 * Todo en una transacción: o se restablece completo o no cambia nada.
 */
export interface ResultadoRestablecer {
  progresos: number;
  respuestas: number;
  certificados: number;
}

export async function restablecerCursoDeEstudiante(courseId: number, correo: string): Promise<ResultadoRestablecer | null> {
  const inscrito = await prisma.portalCourseEnrollment.findUnique({
    where: { course_id_student_email: { course_id: courseId, student_email: correo } },
    select: { id: true },
  });
  if (!inscrito) return null;

  // Incluye los materiales ya eliminados (borrado lógico): su progreso y sus respuestas también cuentan.
  const materiales = await prisma.portalCourseMaterial.findMany({ where: { course_id: courseId }, select: { id: true } });
  const ids = materiales.map((m) => m.id);

  const [progresos, respuestas, certificados] = await prisma.$transaction([
    prisma.portalMaterialProgress.deleteMany({ where: { student_email: correo, material_id: { in: ids } } }),
    prisma.portalFormularioRespuesta.deleteMany({ where: { student_email: correo, material_id: { in: ids } } }),
    prisma.portalCertificate.deleteMany({ where: { course_id: courseId, student_email: correo } }),
  ]);
  return { progresos: progresos.count, respuestas: respuestas.count, certificados: certificados.count };
}
