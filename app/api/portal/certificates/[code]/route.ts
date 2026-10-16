import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { identificar } from '../../../../../lib/portal/acceso';
import { generarCertificadoPdf } from '../../../../../lib/portal/certificado-pdf';
import { formadoresDePortal } from '../../../../../lib/portal/config';
import { archivarCertificadoEnSharePoint } from '../../../../../lib/portal/formacion';
import { descargarArchivoFormacion } from '../../../../../lib/portal/formacion-storage';

/**
 * Sirve el PDF de un certificado ya emitido.
 *
 *   GET /api/portal/certificates/:code
 *
 * Desde 2026-09-30 el PDF se archiva en SharePoint al emitirse
 * (FORMACION/<curso>/certificados/<codigo>.pdf) y este endpoint lo sirve
 * desde allá, como PROXY con la sesión del portal. Si todavía no está
 * archivado (emitido antes del cambio, o SharePoint falló en ese momento),
 * se genera EN EL MOMENTO a partir de los datos congelados en
 * `portal_certificate` —nunca del curso en vivo— y se intenta archivar de
 * paso. Pedirlo dos veces da siempre el mismo contenido.
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

    const nombreArchivo = `Certificado-${certificado.code}.pdf`;
    const disposicion = `inline; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`;

    if (certificado.sp_drive_item_id) {
      try {
        const archivo = await descargarArchivoFormacion(certificado.sp_drive_item_id);
        const headers: Record<string, string> = {
          'Content-Type': 'application/pdf',
          'Content-Disposition': disposicion,
          'Cache-Control': 'private, max-age=300',
        };
        if (archivo.tamano) headers['Content-Length'] = String(archivo.tamano);
        return new NextResponse(archivo.cuerpo, { headers });
      } catch (e) {
        // El certificado es un derecho del estudiante: si SharePoint no
        // responde, se genera igual con los datos congelados.
        console.error('[portal] Certificado no disponible en SharePoint, se genera al vuelo', certificado.code, e);
      }
    } else {
      await archivarCertificadoEnSharePoint(certificado.code).catch((e) =>
        console.error('[portal] No se pudo archivar el certificado en SharePoint', certificado.code, e)
      );
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
        'Content-Disposition': disposicion,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[portal] GET /api/portal/certificates/[code]', error);
    return NextResponse.json({ error: 'No se pudo generar el certificado.' }, { status: 502 });
  }
}
