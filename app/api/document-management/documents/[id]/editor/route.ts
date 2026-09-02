import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { saveDocumentVersionContentAndGeneratePdf, EditorError } from '@/lib/document-management/editor';

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
 * GET: carga documento + `content_html` actual (o null si la versión nunca
 * se editó desde aquí) para precargar Tiptap.
 *
 * POST: guarda el HTML en la MISMA versión vigente (no crea versión nueva,
 * no dispara el flujo de 14 estados — ver decisión documentada en
 * lib/document-management/editor.ts) y regenera+sube el PDF a OneDrive.
 *
 * Mismo guardarraíl que .../pdf/route.ts: solo documentos SIN proceso
 * (`id_process IS NULL`) — los documentos con proceso siguen el flujo
 * formal y quedan fuera de este editor por ahora.
 */
async function resolveEditableVersion(idDocument: number) {
  const document = await prisma.document.findUnique({
    where: { id_document: idDocument },
    include: { company: true, documentType: true },
  });
  if (!document) return null;

  const version = document.current_version_id
    ? await prisma.documentVersion.findUnique({ where: { id_document_version: document.current_version_id } })
    : await prisma.documentVersion.findFirst({
        where: { id_document: idDocument },
        orderBy: { version_number: 'desc' },
      });

  if (!version) return null;
  return { document, version };
}

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

    if (document.id_process != null) {
      return NextResponse.json(
        {
          error:
            'Este documento pertenece a un proceso. El editor solo aplica a documentos sin proceso (Sprint 7/8).',
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      document: {
        id_document: document.id_document,
        code: document.code,
        title: document.title,
        company: document.company.company,
        documentType: document.documentType.name,
      },
      version: {
        id_document_version: version.id_document_version,
        version_number: version.version_number,
        status: version.status,
        content_html: version.content_html,
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

    if (document.id_process != null) {
      return NextResponse.json(
        {
          error:
            'Este documento pertenece a un proceso. El editor solo aplica a documentos sin proceso (Sprint 7/8).',
        },
        { status: 403 }
      );
    }

    const result = await saveDocumentVersionContentAndGeneratePdf({
      idDocument,
      idDocumentVersion: version.id_document_version,
      contentHtml,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof EditorError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error guardando el editor / generando el PDF:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
