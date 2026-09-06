import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks de BD (Prisma), Microsoft Graph y OneDrive -- mismo criterio que el
// resto de la suite: probamos la lógica de orquestación propia, sin tocar
// BD/red de verdad. Rutas relativas al archivo de prueba
// (lib/document-management/__tests__/documents.test.ts).

// vi.mock() se "hoistea" al inicio del archivo, ANTES de cualquier const de
// nivel superior -- por eso los objetos de mock deben crearse dentro de
// vi.hoisted() (si no, referenciarlos en la factory de vi.mock revienta con
// "Cannot access '...' before initialization").
const { prismaMock, getMicrosoftTokenMock, ensureFolderAndUploadFileMock, createDocumentAndStartWorkflowMock } =
  vi.hoisted(() => ({
    prismaMock: {
      company: { findUnique: vi.fn() },
      documentType: { findUnique: vi.fn() },
      document: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
      documentVersion: { findUniqueOrThrow: vi.fn() },
    },
    getMicrosoftTokenMock: vi.fn(),
    ensureFolderAndUploadFileMock: vi.fn(),
    createDocumentAndStartWorkflowMock: vi.fn(),
  }));

vi.mock('../../prisma', () => ({ prisma: prismaMock }));

vi.mock('../../../components/microsoft-365/useGetMicrosoftToken', () => ({
  useGetMicrosoftToken: getMicrosoftTokenMock,
}));

vi.mock('../../onedrive/graphFolderUpload', () => ({
  ensureFolderAndUploadFile: ensureFolderAndUploadFileMock,
}));

vi.mock('../workflowEngine', () => ({
  createDocumentAndStartWorkflow: createDocumentAndStartWorkflowMock,
}));

import {
  createDocumentWithFirstVersion,
  validateCreateDocumentInput,
  CreateDocumentValidationError,
} from '../documents';

describe('validateCreateDocumentInput (validación PURA, sin BD)', () => {
  it('acepta datos válidos y normaliza tipos/espacios', () => {
    const result = validateCreateDocumentInput({
      companyId: '3',
      documentTypeId: '7',
      code: ' POL-GH-001 ',
      title: '  Política de calidad  ',
    });
    expect(result).toEqual({
      companyId: 3,
      documentTypeId: 7,
      code: 'POL-GH-001',
      title: 'Política de calidad',
    });
  });

  it('rechaza companyId faltante', () => {
    expect(() =>
      validateCreateDocumentInput({ companyId: 0, documentTypeId: 1, code: 'A', title: 'T' })
    ).toThrow(CreateDocumentValidationError);
  });

  it('rechaza documentTypeId faltante', () => {
    expect(() =>
      validateCreateDocumentInput({ companyId: 1, documentTypeId: 0, code: 'A', title: 'T' })
    ).toThrow(CreateDocumentValidationError);
  });

  it('rechaza título vacío', () => {
    expect(() =>
      validateCreateDocumentInput({ companyId: 1, documentTypeId: 1, code: 'A', title: '   ' })
    ).toThrow(CreateDocumentValidationError);
  });

  it('propaga el rechazo de getDocumentCodeError como error controlado 400 (bug "CON", 2026-09-03)', () => {
    expect.assertions(3);
    try {
      validateCreateDocumentInput({ companyId: 1, documentTypeId: 1, code: 'CON', title: 'T' });
    } catch (err) {
      expect(err).toBeInstanceOf(CreateDocumentValidationError);
      expect((err as CreateDocumentValidationError).status).toBe(400);
      expect((err as CreateDocumentValidationError).message).toMatch(/nombre reservado de Windows/);
    }
  });
});

describe('createDocumentWithFirstVersion (orquestación: BD + Graph/OneDrive mockeados)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput = {
    companyId: 1,
    documentTypeId: 2,
    code: 'POL-GH-001',
    title: 'Política de calidad',
    file: new Blob(['contenido']),
    fileName: 'politica.pdf',
    fileType: 'application/pdf',
    ownerUserId: 'user-1',
  };

  it('camino de error: código inválido (CON) es error controlado 400 y NO toca BD ni Graph/OneDrive', async () => {
    await expect(createDocumentWithFirstVersion({ ...validInput, code: 'CON' })).rejects.toMatchObject({
      status: 400,
    });

    expect(prismaMock.company.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.documentType.findUnique).not.toHaveBeenCalled();
    expect(getMicrosoftTokenMock).not.toHaveBeenCalled();
    expect(ensureFolderAndUploadFileMock).not.toHaveBeenCalled();
    expect(createDocumentAndStartWorkflowMock).not.toHaveBeenCalled();
  });

  it('camino de error: empresa no encontrada -> 404, no llega a Graph/OneDrive', async () => {
    prismaMock.company.findUnique.mockResolvedValue(null);
    prismaMock.documentType.findUnique.mockResolvedValue({
      id_document_type: 2,
      name: 'Procedimiento',
      is_active: true,
    });

    await expect(createDocumentWithFirstVersion(validInput)).rejects.toMatchObject({ status: 404 });
    expect(getMicrosoftTokenMock).not.toHaveBeenCalled();
  });

  it('camino de error: tipo de documento inactivo -> 404', async () => {
    prismaMock.company.findUnique.mockResolvedValue({ id_company: 1, company: 'Farmalógica S.A.' });
    prismaMock.documentType.findUnique.mockResolvedValue({
      id_document_type: 2,
      name: 'Procedimiento',
      is_active: false,
    });

    await expect(createDocumentWithFirstVersion(validInput)).rejects.toMatchObject({ status: 404 });
    expect(getMicrosoftTokenMock).not.toHaveBeenCalled();
  });

  it('camino de error: código duplicado en la empresa -> 409', async () => {
    prismaMock.company.findUnique.mockResolvedValue({ id_company: 1, company: 'Farmalógica S.A.' });
    prismaMock.documentType.findUnique.mockResolvedValue({
      id_document_type: 2,
      name: 'Procedimiento',
      is_active: true,
    });
    prismaMock.document.findUnique.mockResolvedValue({ id_document: 99 });

    await expect(createDocumentWithFirstVersion(validInput)).rejects.toMatchObject({ status: 409 });
    expect(getMicrosoftTokenMock).not.toHaveBeenCalled();
  });

  it('camino feliz: sube el archivo y arranca la creación de Document + DocumentVersion + requests_general', async () => {
    prismaMock.company.findUnique.mockResolvedValue({ id_company: 1, company: 'Farmalógica S.A.' });
    prismaMock.documentType.findUnique.mockResolvedValue({
      id_document_type: 2,
      name: 'Procedimiento',
      is_active: true,
    });
    prismaMock.document.findUnique.mockResolvedValue(null); // no hay duplicado
    getMicrosoftTokenMock.mockResolvedValue('fake-token');
    ensureFolderAndUploadFileMock.mockResolvedValue({ id: 'onedrive-item-1' });
    createDocumentAndStartWorkflowMock.mockResolvedValue({
      idDocument: 501,
      idDocumentVersion: 9001,
      idRequestGeneral: 7001,
      createdAt: new Date('2026-09-03T10:00:00Z'),
    });
    prismaMock.document.findUniqueOrThrow.mockResolvedValue({ id_document: 501, code: 'POL-GH-001' });
    prismaMock.documentVersion.findUniqueOrThrow.mockResolvedValue({
      id_document_version: 9001,
      version_number: 1,
    });

    const result = await createDocumentWithFirstVersion(validInput);

    expect(getMicrosoftTokenMock).toHaveBeenCalledTimes(1);
    expect(ensureFolderAndUploadFileMock).toHaveBeenCalledWith(
      'fake-token',
      ['GESTION-DOCUMENTAL', 'Farmalógica S.A', 'Procedimiento', 'POL-GH-001', 'v1'],
      'politica.pdf',
      validInput.file,
      'application/pdf'
    );
    expect(createDocumentAndStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        documentTypeId: 2,
        code: 'POL-GH-001',
        title: 'Política de calidad',
        onedriveItemId: 'onedrive-item-1',
        onedrivePath: 'GESTION-DOCUMENTAL/Farmalógica S.A/Procedimiento/POL-GH-001/v1/politica.pdf',
        ownerUserId: 'user-1',
      })
    );
    expect(result.document).toEqual({ id_document: 501, code: 'POL-GH-001' });
    expect(result.version).toEqual({ id_document_version: 9001, version_number: 1 });
    expect(result.idRequestGeneral).toBe(7001);
  });
});
