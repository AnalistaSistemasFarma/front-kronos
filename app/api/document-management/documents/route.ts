import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import {
  getDocumentManagementAccess,
  getDocumentManagementCompanyAccess,
} from '../../../../lib/document-management/access';
import {
  createDocumentWithFirstVersion,
  CreateDocumentValidationError,
} from '../../../../lib/document-management/documents';

/**
 * Listado de documentos VIGENTES (Fase 1: todavía no hay otros estados de
 * flujo) de las empresas a las que el usuario tiene acceso de lectura.
 * Filtrable por empresa y/o tipo de documento vía querystring.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getDocumentManagementAccess(session.user.email);
    const readableCompanyIds = access.filter((a) => a.canRead).map((a) => a.idCompany);
    if (readableCompanyIds.length === 0) {
      return NextResponse.json({ documents: [], companies: access });
    }

    const { searchParams } = new URL(request.url);
    const companyIdParam = searchParams.get('companyId');
    const documentTypeIdParam = searchParams.get('documentTypeId');

    const companyId = companyIdParam ? Number(companyIdParam) : null;
    if (companyId && !readableCompanyIds.includes(companyId)) {
      return NextResponse.json({ error: 'Sin acceso a esa empresa' }, { status: 403 });
    }

    const documents = await prisma.document.findMany({
      where: {
        id_company: companyId ? companyId : { in: readableCompanyIds },
        id_document_type: documentTypeIdParam ? Number(documentTypeIdParam) : undefined,
      },
      include: {
        documentType: true,
        company: true,
        owner: { select: { id: true, name: true, email: true } },
        versions: {
          orderBy: { version_number: 'desc' },
          take: 1,
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    return NextResponse.json({ documents, companies: access });
  } catch (error) {
    console.error('Error listando documentos:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Atajo de Asuntos Regulatorios (Sprint 5): crea un documento nuevo directo,
 * sin pasar por el flujo estándar de "crear solicitud" de SynerLink —
 * reservado a quien tenga el permiso NUEVO
 * `/process/document-management/manage/regulatory` (antes de este sprint
 * bastaba el permiso general de escritura del módulo; ver
 * lib/document-management/access.ts para el porqué del cambio). Produce
 * exactamente la misma estructura de datos que el camino estándar (ver
 * app/api/document-management/create-request/route.ts): ambos llaman a
 * createDocumentWithFirstVersion.
 *
 * multipart/form-data:
 *   file, companyId, documentTypeId, code, title,
 *   dueReviewDate? (YYYY-MM-DD), isRestricted? ("true"/"false"), comments?
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const companyId = Number(formData.get('companyId'));
    if (!companyId) {
      return NextResponse.json({ error: 'Falta la empresa (companyId)' }, { status: 400 });
    }

    const companyAccess = await getDocumentManagementCompanyAccess(
      session.user.email,
      companyId,
      'uploadDirect'
    );
    if (!companyAccess) {
      return NextResponse.json(
        {
          error:
            'No tiene el permiso de Asuntos Regulatorios para cargar documentos directamente en esta empresa. ' +
            'Use el flujo normal de "crear solicitud" seleccionando Gestión Documental.',
        },
        { status: 403 }
      );
    }

    const file = formData.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: 'Falta el archivo a cargar' }, { status: 400 });
    }
    const fileName = file instanceof File ? file.name : 'documento';

    const owner = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!owner) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    const dueReviewDate = formData.get('dueReviewDate');
    const isRestrictedRaw = formData.get('isRestricted');
    const comments = formData.get('comments');

    const result = await createDocumentWithFirstVersion({
      companyId,
      documentTypeId: Number(formData.get('documentTypeId')),
      code: String(formData.get('code') ?? ''),
      title: String(formData.get('title') ?? ''),
      dueReviewDate: dueReviewDate ? String(dueReviewDate) : null,
      isRestricted: isRestrictedRaw === 'true' || isRestrictedRaw === 'on',
      comments: comments ? String(comments) : null,
      file,
      fileName,
      fileType: file.type || 'application/octet-stream',
      ownerUserId: owner.id,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof CreateDocumentValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creando documento:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
