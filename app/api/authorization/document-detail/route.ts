import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

/**
 * Detalle específico del documento detrás de una autorización de tipo
 * "Autorización de documento" (Sprint 6, ver
 * lib/document-management/workflowStates.ts::DOCUMENT_APPROVAL_AUTHORIZATION_TYPE_NAME).
 *
 * Por qué hace falta: el listado genérico de /process/authorization
 * (app/api/authorization/authorization-activities/route.js) solo trae
 * subject/company/requester -- lo mismo que cualquier otro tipo de
 * autorización (tesorería, etc.). No alcanza para saber QUÉ documento es,
 * qué versión, ni quién la elaboró, que era justo lo que Nicolás reportó que
 * faltaba al probar en vivo.
 *
 * Este endpoint resuelve esos datos a partir de
 * `document_version.id_request_general` -- el MISMO campo que usa
 * lib/document-management/workflowEngine.ts::transitionDocumentVersion para
 * ir en el sentido contrario (de la tarea de autorización a la versión). No
 * agrega tabla ni flujo nuevo: es una consulta de solo lectura sobre
 * Document/DocumentVersion (Prisma) + un lookup del autor en `user`.
 *
 * El link para abrir/previsualizar el archivo lo arma el CLIENTE reutilizando
 * el endpoint ya existente
 * .../documents/[id]/versions/[versionId]/open/route.ts (redirige al webUrl
 * de OneDrive) -- no se duplica esa lógica de Graph aquí.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const idRequestGeneral = Number(searchParams.get('id_request_general'));
    if (!idRequestGeneral) {
      return NextResponse.json({ error: 'Se requiere id_request_general' }, { status: 400 });
    }

    // id_request_general es 1:1 con la versión que arrancó ese flujo (ver
    // insertRequestAndFirstTask en workflowEngine.ts), pero se ordena por las
    // dudas y se toma la más reciente si alguna vez hubiera más de una fila.
    const version = await prisma.documentVersion.findFirst({
      where: { id_request_general: idRequestGeneral },
      include: { document: true },
      orderBy: { version_number: 'desc' },
    });
    if (!version) {
      return NextResponse.json(
        { error: 'No hay un documento asociado a esta solicitud' },
        { status: 404 }
      );
    }

    // created_by es una referencia BLANDA a User.id (ver nota en prisma/schema.prisma
    // sobre DocumentVersion.created_by): se resuelve aparte, no hay relation().
    const author = await prisma.user.findUnique({
      where: { id: version.created_by },
      select: { name: true, email: true },
    });

    return NextResponse.json({
      idDocument: version.id_document,
      idDocumentVersion: version.id_document_version,
      code: version.document.code,
      title: version.document.title,
      versionNumber: version.version_number,
      status: version.status,
      elaboratedBy: author?.name || author?.email || null,
    });
  } catch (error) {
    console.error('Error obteniendo el detalle documental de la autorización:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
