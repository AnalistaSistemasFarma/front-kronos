import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';
import { getPool } from '../../../../lib/mssqlPool';
import {
  createDocumentWithFirstVersion,
  CreateDocumentValidationError,
} from '../../../../lib/document-management/documents';
import { resolveWorkflowCatalog } from '../../../../lib/document-management/workflowEngine';
import {
  resolveDocumentFieldsFromFormValues,
  type SubmittedFormValue,
} from '../../../../lib/document-management/genericFields';

/**
 * Camino ESTÁNDAR (Sprint 5, parametrizado después a pedido de Nicolás) para que
 * cualquier usuario autenticado inicie una solicitud de documento NUEVO desde el flujo
 * normal de "crear solicitud" de SynerLink
 * (app/(hub)/process/request-general/create-request/page.tsx), al seleccionar la
 * categoría/proceso "Gestión Documental" (ver DOCUMENT_WORKFLOW_PROCESS_NAME en
 * lib/document-management/workflowStates.ts).
 *
 * Parametrización: "tipo de documento", "código", "próxima fecha de revisión" y
 * "documento restringido" YA NO llegan como campos individuales del formulario -- se
 * leen dinámicamente de process_form_field (id_process_category=86, sembrado por
 * prisma/seeds/document-management-generic-fields.sql), exactamente el MISMO mecanismo
 * que usa cualquier otro proceso de SynerLink (ver
 * app/api/requests-general/process-fields/route.js). El cliente envía esas respuestas
 * en `formValues` (mismo formato que createGeneralRequest.js: [{ id_field, id_option?,
 * value_text? }]); este endpoint las resuelve a los parámetros concretos que sigue
 * necesitando createDocumentAndStartWorkflow vía
 * lib/document-management/genericFields.ts, y las persiste TAL CUAL en
 * request_form_value (dentro de la misma transacción, ver workflowEngine.ts) para que
 * la solicitud se vea igual que cualquier otra en
 * /api/requests-general/request-form-values.
 *
 * `title` (Título del documento) y `comments` (Comentario, opcional) siguen llegando
 * como campos directos: son los campos UNIVERSALES de toda solicitud (subject_request /
 * DocumentVersion.comments), no campos específicos de este proceso -- no tiene sentido
 * duplicarlos en process_form_field. El archivo tampoco pasa por el mecanismo genérico:
 * su ruta de almacenamiento (OneDrive, GESTION-DOCUMENTAL/<EMPRESA>/<TIPO>/<CODIGO>/v1/)
 * es estructuralmente distinta de los adjuntos genéricos de una solicitud (carpeta
 * Request-<id>) y es el contenido versionado del documento, no un soporte.
 *
 * A diferencia de app/api/document-management/documents/route.ts (atajo exclusivo de
 * Asuntos Regulatorios, gateado por el permiso
 * `/process/document-management/manage/regulatory`, que sigue con su propio formulario
 * corto -- decisión de producto, ver la nota de ese route.ts), este endpoint NO exige
 * ningún permiso especial del módulo — solo sesión activa, igual que
 * app/api/requests-general/create-request/route.js.
 *
 * Ambos caminos terminan en la MISMA función (createDocumentWithFirstVersion ->
 * createDocumentAndStartWorkflow), así que producen exactamente la misma estructura de
 * datos: Document + DocumentVersion + requests_general/task_request_general, arrancando
 * en INITIAL_STATE ("En creación").
 *
 * multipart/form-data:
 *   file, companyId, title, comments?, formValues (JSON: [{ id_field, id_option?, value_text? }])
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

    const title = String(formData.get('title') ?? '').trim();
    if (!title) {
      return NextResponse.json({ error: 'El título del documento es obligatorio' }, { status: 400 });
    }
    const comments = formData.get('comments');

    let formValues: SubmittedFormValue[] = [];
    const rawFormValues = formData.get('formValues');
    if (rawFormValues) {
      try {
        formValues = JSON.parse(String(rawFormValues));
        if (!Array.isArray(formValues)) throw new Error('not an array');
      } catch {
        return NextResponse.json({ error: 'El campo formValues no es un JSON válido' }, { status: 400 });
      }
    }

    const pool = await getPool();
    const { processId } = await resolveWorkflowCatalog(pool);
    const resolved = await resolveDocumentFieldsFromFormValues(pool, processId, formValues);

    const result = await createDocumentWithFirstVersion({
      companyId,
      documentTypeId: resolved.documentTypeId,
      code: resolved.code,
      title,
      dueReviewDate: resolved.dueReviewDate,
      isRestricted: resolved.isRestricted,
      comments: comments ? String(comments) : null,
      file,
      fileName,
      fileType: file.type || 'application/octet-stream',
      ownerUserId: owner.id,
      formValues,
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
