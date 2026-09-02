import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { prisma } from '../../../../../../lib/prisma';
import { getDocumentManagementCompanyAccess } from '../../../../../../lib/document-management/access';

/**
 * Sprint 9 — clasifica (o desclasifica) un documento en el catálogo de
 * CATEGORÍAS DE PROCESO DOCUMENTAL, escribiendo
 * `document.id_document_process_subprocess` (FK real, distinta de
 * `document.id_process` — ver el comentario del modelo Document en
 * prisma/schema.prisma). Ruta aparte de documents/[id]/route.ts (que hoy
 * solo expone GET) para no mezclar la lectura del detalle con esta acción
 * de escritura puntual.
 *
 * PATCH { subprocessId: number | null } -> requiere acceso de ESCRITURA del
 * usuario en la empresa del documento (mismo nivel que las acciones del
 * flujo de aprobación, ver lib/document-management/access.ts). subprocessId
 * null = desclasificar (volver a "sin clasificar").
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const idDocument = Number(id);
    if (!idDocument) {
      return NextResponse.json({ error: 'Id inválido' }, { status: 400 });
    }

    const document = await prisma.document.findUnique({ where: { id_document: idDocument } });
    if (!document) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    const access = await getDocumentManagementCompanyAccess(
      session.user.email,
      document.id_company,
      'write'
    );
    if (!access) {
      return NextResponse.json(
        { error: 'No tiene permiso de escritura en el módulo para esta empresa' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const rawSubprocessId = body.subprocessId;

    let subprocessId: number | null = null;
    if (rawSubprocessId !== null && rawSubprocessId !== undefined && rawSubprocessId !== '') {
      subprocessId = Number(rawSubprocessId);
      if (!subprocessId) {
        return NextResponse.json({ error: 'subprocessId inválido' }, { status: 400 });
      }
      const subprocess = await prisma.documentProcessSubprocess.findUnique({
        where: { id: subprocessId },
      });
      if (!subprocess || !subprocess.is_active) {
        return NextResponse.json(
          { error: 'Sub-proceso no encontrado o inactivo' },
          { status: 404 }
        );
      }
    }

    const updated = await prisma.document.update({
      where: { id_document: idDocument },
      data: { id_document_process_subprocess: subprocessId },
      include: {
        documentType: true,
        company: true,
        owner: { select: { id: true, name: true, email: true } },
        processSubprocess: { include: { category: true } },
        versions: { orderBy: { version_number: 'desc' }, take: 1 },
      },
    });

    return NextResponse.json({ document: updated });
  } catch (error) {
    console.error('Error clasificando documento en categoría de proceso:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
