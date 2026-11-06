import { NextRequest, NextResponse } from 'next/server';
import { esFormadorFormacion } from '@/lib/formacion/servidor';
import { prisma } from '../../../../../../lib/prisma';
import { identificar } from '../../../../../../lib/portal/acceso';
import { correoAutorizado, normalizarCorreo } from '../../../../../../lib/portal/auth';
import { nombreDesdeCorreo } from '../../../../../../lib/portal/formacion';
import { puedeMarcarManual } from '../../../../../../lib/portal/permisos-formacion';
import {
  enviarInvitacionCurso,
  puedeInvitar,
  registrarInvitacion,
  urlDelCurso,
  urlPublicaDelPortal,
} from '../../../../../../lib/portal/invitar-curso';

/**
 * FORMACIÓN — invitar a alguien a un curso por correo (Cristian Baldión, 2026-10-14).
 *
 *   POST /api/portal/courses/:id/invitar   { correo }
 *
 * Solo FORMADORES del portal o quienes están en las hojas ADMINISTRADORES/FORMADORES del Excel de permisos (403 a los
 * demás). Envía a ese correo un mensaje con el enlace al curso y deja a la persona INSCRITA. El correo debe poder entrar
 * al portal (dominio del grupo o «Cuentas Autorizadas»): si no, el mensaje no le serviría y se avisa a quien invita.
 * El correo no se escribe en los registros. Ver `lib/portal/invitar-curso.ts`.
 */
const SIN_PERMISO = 'Solo los administradores y formadores de Formación pueden invitar a un curso.';
const SIN_CACHE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  try {
    const invitador = quien.correo.toLowerCase();
    if (!(await esFormadorFormacion(invitador)) && !(await puedeMarcarManual(quien.correo))) {
      return NextResponse.json({ error: SIN_PERMISO }, { status: 403 });
    }
    const courseId = Number((await params).id);
    if (!Number.isInteger(courseId) || courseId <= 0) return NextResponse.json({ error: 'Curso no válido.' }, { status: 400 });

    let cuerpo: { correo?: unknown } | null = null;
    try {
      cuerpo = JSON.parse(await request.text());
    } catch {
      cuerpo = null;
    }
    const correo = normalizarCorreo(cuerpo?.correo);
    if (!correo) return NextResponse.json({ error: 'Escriba un correo válido.' }, { status: 400 });

    // Quien invita sí puede saber si el correo no entra: la ruta de ingreso, en cambio, nunca lo revela (ver /login).
    if (!(await correoAutorizado(correo))) {
      return NextResponse.json(
        { error: 'Ese correo no está autorizado para entrar al portal: debe ser de un dominio del grupo o estar en «Cuentas Autorizadas».' },
        { status: 422 }
      );
    }

    const curso = await prisma.portalCourse.findUnique({ where: { id: courseId }, select: { id: true, title: true, active: true } });
    if (!curso) return NextResponse.json({ error: 'Curso no encontrado.' }, { status: 404 });
    if (!curso.active) {
      return NextResponse.json({ error: 'El curso está en borrador: publíquelo antes de invitar, o la persona no lo vería.' }, { status: 409 });
    }

    const limite = puedeInvitar(invitador, courseId, correo);
    if (!limite.ok) {
      const minutos = Math.max(1, Math.ceil(limite.esperaMs / 60_000));
      return NextResponse.json(
        {
          error:
            limite.motivo === 'reciente'
              ? `Ya le envió una invitación a esa persona hace poco. Puede reenviarla en ${minutos} minuto(s).`
              : `Llegó al tope de invitaciones por hora. Intente de nuevo en ${minutos} minuto(s).`,
        },
        { status: 429 }
      );
    }

    const base = urlPublicaDelPortal();
    if (!base) return NextResponse.json({ error: 'Falta configurar la dirección pública del portal para armar el enlace.' }, { status: 503 });

    // Primero el correo: si no sale, no se deja inscrita a alguien que nunca se enteró.
    await enviarInvitacionCurso({
      correo,
      cursoTitulo: curso.title,
      urlCurso: urlDelCurso(base, courseId),
      invitadoPor: nombreDesdeCorreo(invitador),
    });
    registrarInvitacion(invitador, courseId, correo);

    const antes = await prisma.portalCourseEnrollment.findUnique({
      where: { course_id_student_email: { course_id: courseId, student_email: correo } },
      select: { id: true },
    });
    await prisma.portalCourseEnrollment.upsert({
      where: { course_id_student_email: { course_id: courseId, student_email: correo } },
      update: {},
      create: { course_id: courseId, student_email: correo },
    });

    // Sin el correo del destinatario en el registro.
    console.info('[portal] invitación a curso enviada', { courseId, yaInscrito: !!antes });
    return NextResponse.json({ ok: true, correo, yaInscrito: !!antes }, { headers: SIN_CACHE });
  } catch (error) {
    // Solo mensajes propios del servicio de correo (traen un código HTTP, no datos): un error de Prisma puede traer valores.
    const e = error as Error;
    console.error('[portal] POST .../courses/[id]/invitar:', e.name, e.message?.startsWith('El servicio de correo') ? e.message.slice(0, 120) : '');
    return NextResponse.json({ error: 'No se pudo enviar la invitación. Intente de nuevo en un momento.' }, { status: 502 });
  }
}
