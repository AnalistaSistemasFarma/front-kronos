import { prisma } from '../prisma';
import { sanitizeOneDriveName } from '../onedriveName';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { ensureFolderAndUploadFile } from '../onedrive/graphFolderUpload';
import { buildDocumentVersionFolderSegments, getDocumentCodeError } from './storagePath';
import { createDocumentAndStartWorkflow } from './workflowEngine';
import type { SubmittedFormValue } from './genericFields';

/**
 * Creación de un documento NUEVO (primer `DocumentType` + primera versión),
 * subiendo el archivo a OneDrive bajo
 * GESTION-DOCUMENTAL/<EMPRESA>/<TIPO>/<CODIGO>/v1/<archivo>.
 *
 * Sprint 5 (2026-09-02): esta función es el punto de entrada COMPARTIDO por
 * los dos caminos de creación de un documento nuevo (antes solo existía el
 * atajo directo):
 *   1. Camino estándar: cualquier usuario, desde el flujo normal de "crear
 *      solicitud" de SynerLink — ver
 *      app/api/document-management/create-request/route.ts.
 *   2. Atajo de Asuntos Regulatorios: el botón "Cargar documento" en
 *      /process/document-management, gateado por el permiso
 *      `/process/document-management/manage/regulatory` — ver
 *      app/api/document-management/documents/route.ts.
 * Antes de este sprint, esta función creaba el documento DIRECTO en estado
 * "Vigente", sin flujo de aprobación (era la única forma de cargar un
 * documento — carga histórica). Ahora delega en
 * createDocumentAndStartWorkflow (workflowEngine.ts), que arranca el mismo
 * flujo de 14 estados que cualquier otra versión: el documento queda en
 * INITIAL_STATE ("En creación") con su `requests_general`/
 * `task_request_general` ya creados, exactamente igual sin importar por cuál
 * de los dos caminos haya entrado.
 *
 * Orden de operaciones: primero se sube el archivo a OneDrive y solo si eso
 * tiene éxito se escribe en la base (Document + DocumentVersion + arranque
 * del flujo, en una única transacción — ver createDocumentAndStartWorkflow).
 * Si la subida falla, no queda ningún registro huérfano en la base. Si la
 * subida tiene éxito pero la transacción falla, puede quedar un archivo
 * huérfano en OneDrive (aceptable: es preferible a un registro que apunte a
 * un archivo inexistente).
 */

export interface CreateDocumentInput {
  companyId: number;
  documentTypeId: number;
  code: string;
  title: string;
  dueReviewDate?: string | null;
  isRestricted?: boolean;
  comments?: string | null;
  file: Blob;
  fileName: string;
  fileType?: string;
  ownerUserId: string;
  /**
   * Parametrización (post-Sprint 5): valores tal cual los envió el camino ESTÁNDAR (el
   * usuario respondió los campos genéricos sembrados en process_form_field para
   * id_process_category=86 -- ver lib/document-management/genericFields.ts). Se persisten
   * verbatim en request_form_value dentro de la misma transacción que arranca el flujo,
   * para que la solicitud se vea igual que cualquier otra en
   * /api/requests-general/request-form-values. El atajo de Asuntos Regulatorios
   * (app/api/document-management/documents/route.ts) no pasa este campo -- sigue sin usar
   * el mecanismo genérico, ver la nota de módulo de ese route.ts.
   */
  formValues?: SubmittedFormValue[];
}

export class CreateDocumentValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Valida los campos de texto/negocio (no toca BD ni Graph). */
export function validateCreateDocumentInput(input: {
  companyId?: unknown;
  documentTypeId?: unknown;
  code?: unknown;
  title?: unknown;
}): { companyId: number; documentTypeId: number; code: string; title: string } {
  const companyId = Number(input.companyId);
  const documentTypeId = Number(input.documentTypeId);
  const code = String(input.code ?? '').trim();
  const title = String(input.title ?? '').trim();

  if (!companyId) throw new CreateDocumentValidationError('Falta la empresa (companyId)');
  if (!documentTypeId) throw new CreateDocumentValidationError('Falta el tipo de documento (documentTypeId)');
  if (!title) throw new CreateDocumentValidationError('El título es obligatorio');

  const codeError = getDocumentCodeError(code);
  if (codeError) throw new CreateDocumentValidationError(codeError);

  return { companyId, documentTypeId, code, title };
}

export async function createDocumentWithFirstVersion(input: CreateDocumentInput) {
  const { companyId, documentTypeId, code, title } = validateCreateDocumentInput(input);
  const { dueReviewDate, isRestricted, comments } = input;

  const [company, documentType] = await Promise.all([
    prisma.company.findUnique({ where: { id_company: companyId } }),
    prisma.documentType.findUnique({ where: { id_document_type: documentTypeId } }),
  ]);
  if (!company) throw new CreateDocumentValidationError('Empresa no encontrada', 404);
  if (!documentType || !documentType.is_active) {
    throw new CreateDocumentValidationError('Tipo de documento no encontrado o inactivo', 404);
  }

  const existing = await prisma.document.findUnique({
    where: { id_company_code: { id_company: companyId, code } },
  });
  if (existing) {
    throw new CreateDocumentValidationError(
      `Ya existe el documento "${code}" en ${company.company}`,
      409
    );
  }

  const versionNumber = 1;
  const segments = buildDocumentVersionFolderSegments({
    companyName: company.company,
    documentTypeName: documentType.name,
    code,
    versionNumber,
  });
  const fileName = sanitizeOneDriveName(input.fileName);
  const fullPath = [...segments, fileName].join('/');

  const token = await getMicrosoftToken();
  if (!token) throw new Error('No se pudo obtener el token de Microsoft Graph');

  const uploaded = await ensureFolderAndUploadFile(
    token,
    segments,
    fileName,
    input.file,
    input.fileType
  );

  const started = await createDocumentAndStartWorkflow({
    companyId,
    documentTypeId,
    code,
    title,
    dueReviewDate: dueReviewDate ? new Date(dueReviewDate) : null,
    isRestricted: Boolean(isRestricted),
    comments: comments || null,
    onedriveItemId: uploaded.id,
    onedrivePath: fullPath,
    ownerUserId: input.ownerUserId,
    formValues: input.formValues,
  });

  const [document, version] = await Promise.all([
    prisma.document.findUniqueOrThrow({ where: { id_document: started.idDocument } }),
    prisma.documentVersion.findUniqueOrThrow({ where: { id_document_version: started.idDocumentVersion } }),
  ]);

  return { document, version, company, documentType, idRequestGeneral: started.idRequestGeneral };
}
