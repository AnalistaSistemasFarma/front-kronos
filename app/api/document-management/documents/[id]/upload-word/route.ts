import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { saveWordUploadContent, EditorError } from '@/lib/document-management/editor';

/**
 * Subproceso PROPIO del Generador de Documentos (mismo criterio que
 * .../editor/route.ts, .../generator/route.ts y .../pdf/route.ts: permiso
 * independiente del acceso general de Gestión Documental, resuelto en línea
 * a propósito — ver el comentario de esos archivos para el porqué).
 */
const DOCUMENT_GENERATOR_URL = '/process/document-management/generador';

async function hasDocumentGeneratorCompanyAccess(userEmail: string, companyId: number): Promise<boolean> {
  const count = await prisma.subprocessUserCompany.count({
    where: {
      companyUser: { user: { email: userEmail }, id_company: companyId },
      subprocess: { subprocess_url: DOCUMENT_GENERATOR_URL },
    },
  });
  return count > 0;
}

const WORD_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Tope defensivo: mammoth carga el archivo completo en memoria para
// convertirlo. Ningún otro endpoint del módulo impone un límite explícito
// (versions/route.ts sube el archivo tal cual a OneDrive sin tope), pero acá
// sí se procesa en el propio proceso de Next.js, así que se acota por
// prudencia — 20 MB es generoso para un documento de texto/tablas.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Sprint 9 — Carga inicial de contenido editable del editor (Tiptap) a
 * partir de un Word (.docx) ya existente.
 *
 * Aclaración de negocio de Nicolás (2026-09-03, con captura de pantalla): el
 * usuario NO crea el documento escribiendo desde cero en el editor en
 * blanco — SUBE un .docx ya elaborado y ese contenido convertido a HTML es
 * el punto de partida para que otros usuarios trabajen colaborativamente
 * sobre esa plantilla en el editor online.
 *
 * multipart/form-data: `file` (.docx). Convierte con `mammoth.convertToHtml`
 * (usa el buffer del archivo, sin tocar disco ni OneDrive) y persiste el
 * HTML resultante en `content_html` de la versión editable del documento
 * (`saveWordUploadContent`, lib/document-management/editor.ts) — la MISMA
 * versión que resuelve GET/POST .../editor (vigente, con fallback a la de
 * mayor version_number). Esa función ya trae la salvaguarda de NO
 * sobrescribir una versión que ya tenga contenido o que esté "Vigente"/en
 * un estado cerrado del flujo.
 *
 * No genera PDF, no sube nada a OneDrive, no crea versión nueva ni toca el
 * flujo de 14 estados — el usuario sigue después con "Guardar" del editor
 * (Caso A/B normal) una vez revise/ajuste el contenido convertido.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const idDocument = Number(id);
    if (!idDocument) return NextResponse.json({ error: 'Id inválido' }, { status: 400 });

    const document = await prisma.document.findUnique({ where: { id_document: idDocument } });
    if (!document) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });

    const access = await hasDocumentGeneratorCompanyAccess(session.user.email, document.id_company);
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    }

    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: 'Falta el archivo .docx a cargar' }, { status: 400 });
    }

    const fileName = file instanceof File ? file.name : '';
    const hasWordExtension = fileName.toLowerCase().endsWith('.docx');
    const hasWordMimeType = file.type === WORD_MIME_TYPE;
    if (!hasWordExtension && !hasWordMimeType) {
      return NextResponse.json(
        { error: 'El archivo debe ser un Word en formato .docx' },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `El archivo supera el tamaño máximo permitido (${MAX_UPLOAD_BYTES / (1024 * 1024)} MB)` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let contentHtml: string;
    try {
      const conversion = await mammoth.convertToHtml({ buffer });
      contentHtml = conversion.value;
      if (conversion.messages?.length) {
        // Advertencias de mammoth (p.ej. estilos no reconocidos) -- no
        // bloquean la conversión, solo quedan en el log del servidor.
        console.warn(
          `Advertencias convirtiendo Word a HTML (documento ${idDocument}):`,
          conversion.messages.map((m) => m.message)
        );
      }
    } catch (conversionError) {
      console.error(`Error convirtiendo el Word a HTML (documento ${idDocument}):`, conversionError);
      return NextResponse.json(
        { error: 'No se pudo convertir el archivo Word. Verifique que sea un .docx válido y no esté dañado.' },
        { status: 422 }
      );
    }

    if (!contentHtml || contentHtml.trim().length === 0) {
      return NextResponse.json(
        { error: 'El Word no tiene contenido reconocible para convertir' },
        { status: 422 }
      );
    }

    const result = await saveWordUploadContent({ idDocument, contentHtml });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof EditorError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error cargando el Word convertido en el editor:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
