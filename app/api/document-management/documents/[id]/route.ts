import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '../../../../../lib/prisma';
import { getDocumentManagementCompanyAccess } from '../../../../../lib/document-management/access';

/** Detalle de un documento (con todas sus versiones, la más nueva primero). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const document = await prisma.document.findUnique({
      where: { id_document: idDocument },
      include: {
        documentType: true,
        company: true,
        owner: { select: { id: true, name: true, email: true } },
        versions: { orderBy: { version_number: 'desc' } },
      },
    });
    if (!document) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    const access = await getDocumentManagementCompanyAccess(
      session.user.email,
      document.id_company,
      'read'
    );
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a esta empresa' }, { status: 403 });
    }

    return NextResponse.json({ document });
  } catch (error) {
    console.error('Error obteniendo documento:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
