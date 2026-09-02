import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import {
  createDocumentWithFirstVersion,
  CreateDocumentValidationError,
} from '../../../../lib/document-management/documents';

/**
 * Camino ESTÁNDAR (Sprint 5) para que cualquier usuario autenticado inicie
 * una solicitud de documento NUEVO desde el flujo normal de "crear
 * solicitud" de SynerLink
 * (app/(hub)/process/request-general/create-request/page.tsx), al
 * seleccionar la categoría/proceso "Gestión Documental" (ver
 * DOCUMENT_WORKFLOW_PROCESS_NAME en lib/document-management/workflowStates.ts,
 * usado en esa página para detectar la selección y mostrar los campos
 * propios del documento en vez de los campos genéricos del formulario).
 *
 * A diferencia de app/api/document-management/documents/route.ts (atajo
 * exclusivo de Asuntos Regulatorios, gateado por el permiso
 * `/process/document-management/manage/regulatory`), este endpoint NO exige
 * ningún permiso especial del módulo — solo sesión activa, igual que
 * app/api/requests-general/create-request/route.js (el motor genérico de
 * "solicitudes generales" tampoco gatea QUIÉN puede crear una solicitud,
 * solo quién la recibe). Cualquier usuario puede solicitar un documento
 * nuevo, igual que puede crear cualquier otra solicitud general.
 *
 * Ambos caminos terminan en la MISMA función
 * (createDocumentWithFirstVersion -> createDocumentAndStartWorkflow), así
 * que producen exactamente la misma estructura de datos: Document +
 * DocumentVersion + requests_general/task_request_general, arrancando en
 * INITIAL_STATE ("En creación"). La solicitud creada aparece igual que
 * cualquier otra en el panel de "Solicitudes Generales" y en
 * /process/document-management (que sigue leyendo Document/DocumentVersion
 * sin cambios).
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

    const owner = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!owner) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    const formData = await request.formData();
    const companyId = Number(formData.get('companyId'));
    if (!companyId) {
      return NextResponse.json({ error: 'Falta la empresa (companyId)' }, { status: 400 });
    }

    const file = formData.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: 'Falta el archivo a cargar' }, { status: 400 });
    }
    const fileName = file instanceof File ? file.name : 'documento';

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
    console.error('Error creando solicitud de documento:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
