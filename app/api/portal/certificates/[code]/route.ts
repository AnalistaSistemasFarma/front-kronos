import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { identificar } from '../../../../../lib/portal/acceso';
import { generarCertificadoPdf } from '../../../../../lib/portal/certificado-pdf';
import { formadoresDePortal } from '../../../../../lib/portal/config';

/**
 * Sirve el PDF de un certificado ya emitido.
 *
 *   GET /api/portal/certificates/:code
 *
 * Se genera EN EL MOMENTO a partir de los datos congelados en
 * `portal_certificate` (nunca del curso en vivo): pedirlo dos veces da
 * siempre el mismo PDF, así el curso haya cambiado de nombre después.
 *
 * Exige sesión del portal, igual que el resto de los archivos que sirve —
 * pero no exige ser el DUEÑO del certificado: un formador puede necesitar
 * abrir el de un estudiante para confirmar que es válido, y el código en sí
 * ya funciona como el secreto (40 caracteres, no se adivina). Si más
 * adelante Talento Humano pide una verificación pública sin sesión —para
 * que un tercero fuera del grupo confirme un certificado—, es un segundo
 * endpoint aparte, deliberadamente NO éste.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const quien = await identificar(request);
  if (!quien) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const { code } = await params;
  if (!code || code.length > 40) return NextResponse.json({ error: 'Código no válido.' }, { status: 400 });

  const esFormador = formadoresDePortal().includes(quien.correo.toLowerCase());

  try {
    const certificado = await prisma.portalCertificate.findUnique({ where: { code } });
    if (!certificado) return NextResponse.json({ error: 'Certificado no encontrado.' }, { status: 404 });

    if (certificado.student_email !== quien.correo && !esFormador) {
      return NextResponse.json({ error: 'No tiene acceso a este certificado.' }, { status: 403 });
    }

    const pdf = await generarCertificadoPdf({
      code: certificado.code,
      studentName: certificado.student_name,
      courseTitle: certificado.course_title,
      issuedAt: certificado.issued_at,
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(`Certificado-${certificado.code}.pdf`)}`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[portal] GET /api/portal/certificates/[code]', error);
    return NextResponse.json({ error: 'No se pudo generar el certificado.' }, { status: 502 });
  }
}
