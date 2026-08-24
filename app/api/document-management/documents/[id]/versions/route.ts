import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { prisma } from '../../../../../../lib/prisma';
import { getDocumentManagementCompanyAccess } from '../../../../../../lib/document-management/access';
import { createNewDocumentVersion, CreateVersionError } from '../../../../../../lib/document-management/newVersion';

/**
 * Carga una versión NUEVA de un documento existente y arranca su flujo de
 * aprobación de 14 estados (Fase 2), en "En creación". multipart/form-data:
 *   file, comments?
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

    const access = await getDocumentManagementCompanyAccess(session.user.email, document.id_company, 'write');
    if (!access) {
      return NextResponse.json({ error: 'No tiene permiso de escritura en esta empresa' }, { status: 403 });
    }

    const actor = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    if (!actor) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: 'Falta el archivo a cargar' }, { status: 400 });
    }
    const fileName = file instanceof File ? file.name : 'documento';
    const comments = formData.get('comments');

    const result = await createNewDocumentVersion({
      idDocument,
      comments: comments ? String(comments) : null,
      file,
      fileName,
      fileType: file.type || 'application/octet-stream',
      actorUserId: actor.id,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof CreateVersionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creando nueva versión del documento:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
