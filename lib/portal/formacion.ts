/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN.
 *
 * Reglas compartidas por las rutas de cursos: cómo se calcula el progreso de
 * un estudiante y cuándo se emite (o se reimprime) su certificado. Vive
 * aparte de las rutas API para que las dos —la de marcar un material como
 * completado y la que arma el detalle de un curso— calculen el mismo número
 * de la misma forma.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma';

/** Un material tal como lo necesita el cálculo de progreso. */
interface MaterialParaProgreso {
  id: number;
  required: boolean;
}

/**
 * % de avance de un estudiante en un curso.
 *
 * Solo cuentan los materiales OBLIGATORIOS: uno opcional (un enlace "para el
 * que quiera profundizar", por ejemplo) no debe bloquear el 100%. Si el curso
 * no tiene ningún material obligatorio, se considera completo de una vez —no
 * hay nada que le falte marcar a nadie.
 */
export function calcularProgreso(
  materiales: MaterialParaProgreso[],
  completadosIds: Set<number>
): { porcentaje: number; obligatoriosTotal: number; obligatoriosHechos: number } {
  const obligatorios = materiales.filter((m) => m.required);
  const obligatoriosTotal = obligatorios.length;
  if (obligatoriosTotal === 0) return { porcentaje: 100, obligatoriosTotal: 0, obligatoriosHechos: 0 };

  const obligatoriosHechos = obligatorios.filter((m) => completadosIds.has(m.id)).length;
  const porcentaje = Math.round((obligatoriosHechos / obligatoriosTotal) * 100);
  return { porcentaje, obligatoriosTotal, obligatoriosHechos };
}

/** Código de verificación del certificado: corto, legible, difícil de adivinar. */
function generarCodigo(): string {
  // 8 caracteres de un UUID, en mayúsculas: se puede transcribir a mano desde
  // un PDF impreso sin que sea una cadena de 36 caracteres imposible de leer.
  return `GSS-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/**
 * Si el estudiante llegó al 100% del curso, emite su certificado — o, si ya
 * tenía uno, devuelve el mismo sin tocarlo.
 *
 * NUNCA regenera uno existente con datos distintos: `student_name` y
 * `course_title` quedan congelados desde la primera vez, a propósito (ver la
 * migración). Se llama después de marcar (o desmarcar) un material.
 */
export async function emitirCertificadoSiCorresponde(params: {
  courseId: number;
  studentEmail: string;
  studentName: string;
  courseTitle: string;
  porcentaje: number;
}): Promise<{ code: string; issuedAt: Date } | null> {
  const { courseId, studentEmail, studentName, courseTitle, porcentaje } = params;
  if (porcentaje < 100) return null;

  const existente = await prisma.portalCertificate.findUnique({
    where: { course_id_student_email: { course_id: courseId, student_email: studentEmail } },
    select: { code: true, issued_at: true },
  });
  if (existente) return { code: existente.code, issuedAt: existente.issued_at };

  // Reintenta si por una coincidencia de 1 en muchos millones el código ya
  // existe — más barato que una transacción con reintento manual completo.
  for (let intento = 0; intento < 3; intento++) {
    try {
      const creado = await prisma.portalCertificate.create({
        data: {
          code: generarCodigo(),
          course_id: courseId,
          student_email: studentEmail,
          student_name: studentName,
          course_title: courseTitle,
        },
        select: { code: true, issued_at: true },
      });
      return { code: creado.code, issuedAt: creado.issued_at };
    } catch (error) {
      const mensaje = (error as { code?: string })?.code;
      if (mensaje !== 'P2002' || intento === 2) throw error;
    }
  }
  return null;
}

/** El nombre a mostrar de un estudiante cuando no hay más que su correo. */
export function nombreDesdeCorreo(correo: string): string {
  const usuario = correo.split('@')[0] ?? correo;
  return usuario
    .split(/[._-]+/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
}

/**
 * El nombre de pila de un estudiante para mostrar en la interfaz y estampar
 * en el certificado.
 *
 * El portal solo garantiza un correo (ver `lib/portal/acceso.ts`): quien
 * entra por código nunca dio su nombre. Si esa persona SÍ tiene usuario en
 * SynerLink (`user.name`), se usa ese; si no, se deriva del correo — mejor
 * "Nicolas Rivera" que nada, y mejor eso que bloquear la emisión del
 * certificado por un dato que el portal nunca pidió.
 */
export async function resolverNombreEstudiante(correo: string): Promise<string> {
  const usuario = await prisma.user.findUnique({ where: { email: correo }, select: { name: true } });
  const nombre = usuario?.name?.trim();
  return nombre || nombreDesdeCorreo(correo);
}
