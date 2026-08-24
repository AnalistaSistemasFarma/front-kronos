import { prisma } from '../prisma';
import { sanitizeOneDriveName } from '../onedriveName';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { ensureFolderAndUploadFile } from '../onedrive/graphFolderUpload';
import { buildDocumentVersionFolderSegments, getDocumentCodeError } from './storagePath';

/**
 * Carga inicial (Fase 1) de un documento: crea el encabezado (Document) y su
 * primera versión (DocumentVersion), subiendo el archivo a OneDrive bajo
 * GESTION-DOCUMENTAL/<EMPRESA>/<TIPO>/<CODIGO>/v1/<archivo>.
 *
 * Todo el documento se crea directo en estado "Vigente" (carga histórica),
 * SIN pasar por flujo de aprobación: eso es Fase 2.
 *
 * Orden de operaciones: primero se sube el archivo a OneDrive y solo si eso
 * tiene éxito se escribe en la base de datos (Document + DocumentVersion en
 * una transacción). Si la subida falla, no queda ningún registro huérfano en
 * la base. Si la subida tiene éxito pero la transacción falla, puede quedar
 * un archivo huérfano en OneDrive (aceptable: es preferible a un registro que
 * apunte a un archivo inexistente).
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

  const { document, version } = await prisma.$transaction(async (tx) => {
    const createdDocument = await tx.document.create({
      data: {
        code,
        title,
        id_document_type: documentTypeId,
        id_company: companyId,
        owner_user_id: input.ownerUserId,
        due_review_date: dueReviewDate ? new Date(dueReviewDate) : null,
        is_restricted: Boolean(isRestricted),
        current_status: 'Vigente',
      },
    });

    const createdVersion = await tx.documentVersion.create({
      data: {
        id_document: createdDocument.id_document,
        version_number: versionNumber,
        status: 'Vigente',
        onedrive_item_id: uploaded.id,
        onedrive_path: fullPath,
        created_by: input.ownerUserId,
        comments: comments || null,
      },
    });

    const updatedDocument = await tx.document.update({
      where: { id_document: createdDocument.id_document },
      data: { current_version_id: createdVersion.id_document_version },
    });

    return { document: updatedDocument, version: createdVersion };
  });

  return { document, version, company, documentType };
}
