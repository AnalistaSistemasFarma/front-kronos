import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import {
  generatePdfForDownload,
  createNewVersionFromEditorAndStartWorkflow,
  resolveEditableVersion,
  resolveDisplayContentHtml,
  EditorError,
} from '@/lib/document-management/editor';

/**
 * Subproceso PROPIO del Generador de Documentos (mismo criterio que
 * .../generator/route.ts y .../pdf/route.ts: permiso independiente del
 * acceso general de Gestión Documental, resuelto en línea a propósito —
 * ver el comentario de esos archivos para el porqué).
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

/**
 * Sprint 8 — Editor de documentos (Tiptap + PDF con Chrome headless).
 *
 * Trabaja siempre sobre la versión VIGENTE del documento
 * (`document.current_version_id`, con fallback a la de mayor
 * version_number si por alguna razón ese campo estuviera vacío — no
 * debería pasar para un documento listado en el Generador, que solo
 * muestra "Vigente").
 *
 * GET: carga documento (incluido `id_process`, para que el front sepa qué
 * comportamiento de "Guardar" aplica) + `content_html` actual de la versión
 * vigente (o null si nunca se editó desde aquí) para precargar Tiptap.
 *
 * POST: decisión de producto de Nicolás (2026-09-03) — el comportamiento
 * depende de si el documento tiene proceso/categoría asociado
 * (`document.id_process`), y esa decisión se toma SIEMPRE del lado del
 * servidor (releyendo `document.id_process` de la base), nunca de un flag
 * que mande el cliente:
 *
 *   - `id_process IS NULL` (Caso A): genera el PDF y lo devuelve como
 *     descarga binaria (`Content-Type: application/pdf`). No toca OneDrive
 *     ni la base de datos.
 *   - `id_process IS NOT NULL` (Caso B): crea una VERSIÓN NUEVA (nunca
 *     sobrescribe la vigente) y arranca su flujo de aprobación de 14
 *     estados. Devuelve JSON con la versión nueva creada. La versión
 *     vigente actual no cambia.
 *
 * Ver lib/document-management/editor.ts para el detalle de cada camino.
 *
 * `resolveEditableVersion` (resolución de la versión vigente/editable) vive
 * en lib/document-management/editor.ts, no aquí — se movió para que también
 * la reuse app/api/document-management/documents/[id]/upload-word/route.ts
 * sin duplicar la lógica de resolución.
 */

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const idDocument = Number(id);
    if (!idDocument) return NextResponse.json({ error: 'Id inválido' }, { status: 400 });

    const resolved = await resolveEditableVersion(idDocument);
    if (!resolved) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    const { document, version } = resolved;

    const access = await hasDocumentGeneratorCompanyAccess(session.user.email, document.id_company);
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    }

    // Fix 2026-09-04 (bug documento id=17): si `content_html` está NULL pero
    // la versión ya tiene un .docx real en OneDrive (subido por la carga
    // normal de archivos, no por el editor), se convierte al vuelo solo
    // para precargar la vista -- ver comentario de
    // `resolveDisplayContentHtml` en lib/document-management/editor.ts.
    const displayContentHtml = await resolveDisplayContentHtml(version);

    return NextResponse.json({
      document: {
        id_document: document.id_document,
        code: document.code,
        title: document.title,
        company: document.company.company,
        documentType: document.documentType.name,
        id_process: document.id_process,
      },
      version: {
        id_document_version: version.id_document_version,
        version_number: version.version_number,
        status: version.status,
        content_html: displayContentHtml,
        onedrive_item_id: version.onedrive_item_id,
      },
    });
  } catch (error) {
    console.error('Error cargando el editor del documento:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const idDocument = Number(id);
    if (!idDocument) return NextResponse.json({ error: 'Id inválido' }, { status: 400 });

    const body = await request.json().catch(() => null);
    const contentHtml = body?.content_html;
    if (typeof contentHtml !== 'string' || contentHtml.trim().length === 0) {
      return NextResponse.json({ error: 'El contenido no puede estar vacío' }, { status: 400 });
    }

    const resolved = await resolveEditableVersion(idDocument);
    if (!resolved) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    const { document, version } = resolved;

    const access = await hasDocumentGeneratorCompanyAccess(session.user.email, document.id_company);
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    }

    if (document.id_process == null) {
      // Caso A: descarga directa al navegador. No toca OneDrive ni la BD.
      const { pdfBuffer, fileName } = await generatePdfForDownload({
        idDocument,
        idDocumentVersion: version.id_document_version,
        contentHtml,
      });
      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    }

    // Caso B: nueva versión + flujo de aprobación de 14 estados.
    const actor = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    if (!actor) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

    const result = await createNewVersionFromEditorAndStartWorkflow({
      idDocument,
      contentHtml,
      actorUserId: actor.id,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof EditorError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error guardando el editor / generando el PDF:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
