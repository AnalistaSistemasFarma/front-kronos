import { prisma } from '../prisma';
import { sanitizeOneDriveName } from '../onedriveName';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { ensureFolderAndUploadFile } from '../onedrive/graphFolderUpload';
import { buildDocumentVersionFolderSegments } from './storagePath';
import { createDocumentVersionAndStartWorkflow } from './workflowEngine';
import { INITIAL_STATE } from './workflowStates';

/**
 * Carga de una versión NUEVA de un documento YA EXISTENTE (Fase 2): a
 * diferencia de `createDocumentWithFirstVersion` (Fase 1, que crea la
 * primera versión directo en "Vigente" para la migración histórica), esta
 * versión arranca en "En creación" y queda sujeta al flujo de aprobación de
 * 14 estados (ver workflowEngine.ts). Mismo orden de operaciones que Fase 1:
 * primero se sube el archivo a OneDrive (operación externa, no
 * transaccional) y SOLO si eso tiene éxito se escribe en la base — y esa
 * escritura (DocumentVersion + arranque del flujo) es una única transacción
 * atómica (ver createDocumentVersionAndStartWorkflow en workflowEngine.ts:
 * antes de este fix quedaban versiones huérfanas si el arranque del flujo
 * fallaba después de que la versión ya se hubiera confirmado por su cuenta).
 */

export interface CreateNewVersionInput {
  idDocument: number;
  comments?: string | null;
  file: Blob;
  fileName: string;
  fileType?: string;
  actorUserId: string;
}

export class CreateVersionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function createNewDocumentVersion(input: CreateNewVersionInput) {
  const document = await prisma.document.findUnique({
    where: { id_document: input.idDocument },
    include: { company: true, documentType: true },
  });
  if (!document) throw new CreateVersionError('Documento no encontrado', 404);

  const lastVersion = await prisma.documentVersion.findFirst({
    where: { id_document: input.idDocument },
    orderBy: { version_number: 'desc' },
  });
  const versionNumber = (lastVersion?.version_number ?? 0) + 1;

  const segments = buildDocumentVersionFolderSegments({
    companyName: document.company.company,
    documentTypeName: document.documentType.name,
    code: document.code,
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

  const { idDocumentVersion, createdAt, idRequestGeneral } = await createDocumentVersionAndStartWorkflow({
    idDocument: input.idDocument,
    versionNumber,
    onedriveItemId: uploaded.id,
    onedrivePath: fullPath,
    createdBy: input.actorUserId,
    comments: input.comments || null,
    idCompany: document.id_company,
    ownerUserId: document.owner_user_id,
    subject: `${document.code} v${versionNumber} — ${document.title}`,
  });

  const version = {
    id_document_version: idDocumentVersion,
    id_document: input.idDocument,
    version_number: versionNumber,
    status: INITIAL_STATE,
    onedrive_item_id: uploaded.id,
    onedrive_path: fullPath,
    created_by: input.actorUserId,
    created_at: createdAt,
    comments: input.comments || null,
    id_request_general: idRequestGeneral,
  };

  return { document, version };
}
