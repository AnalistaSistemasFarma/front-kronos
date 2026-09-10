import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks de las dependencias externas (BD real, Microsoft Graph, OneDrive,
// Chrome headless) -- mismo criterio que el resto de la suite: solo
// probamos lógica PROPIA, sin tocar BD/red de verdad. Rutas relativas al
// archivo de prueba (lib/document-management/__tests__/editor.test.ts).

// vi.mock() se "hoistea" al inicio del archivo, ANTES de cualquier const de
// nivel superior -- por eso los objetos de mock deben crearse dentro de
// vi.hoisted() (si no, referenciarlos en la factory de vi.mock revienta con
// "Cannot access '...' before initialization").
const {
  prismaMock,
  getMicrosoftTokenMock,
  ensureFolderAndUploadFileMock,
  createDocumentVersionAndStartWorkflowMock,
  puppeteerLaunchMock,
} = vi.hoisted(() => {
  const puppeteerPageMock = {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(Buffer.from('%FAKE-PDF-BYTES%')),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const puppeteerBrowserMock = {
    newPage: vi.fn().mockResolvedValue(puppeteerPageMock),
  };
  return {
    prismaMock: {
      documentVersion: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      document: {
        findUnique: vi.fn(),
      },
    },
    getMicrosoftTokenMock: vi.fn(),
    ensureFolderAndUploadFileMock: vi.fn(),
    createDocumentVersionAndStartWorkflowMock: vi.fn(),
    puppeteerPageMock,
    puppeteerLaunchMock: vi.fn().mockResolvedValue(puppeteerBrowserMock),
  };
});

vi.mock('../../prisma', () => ({ prisma: prismaMock }));

vi.mock('../../../components/microsoft-365/useGetMicrosoftToken', () => ({
  useGetMicrosoftToken: getMicrosoftTokenMock,
}));

vi.mock('../../onedrive/graphFolderUpload', () => ({
  ensureFolderAndUploadFile: ensureFolderAndUploadFileMock,
}));

vi.mock('../workflowEngine', () => ({
  createDocumentVersionAndStartWorkflow: createDocumentVersionAndStartWorkflowMock,
}));

vi.mock('puppeteer', () => ({
  default: { launch: puppeteerLaunchMock },
}));

import {
  generatePdfForDownload,
  createNewVersionFromEditorAndStartWorkflow,
  saveWordUploadContent,
  EditorError,
} from '../editor';
import { INITIAL_STATE } from '../workflowStates';

describe('generatePdfForDownload (Caso A -- documento SIN proceso, id_process null)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('genera el PDF para descarga y NO toca OneDrive ni escribe en DocumentVersion', async () => {
    prismaMock.documentVersion.findUnique.mockResolvedValue({
      id_document_version: 55,
      id_document: 10,
      version_number: 2,
      document: { title: 'Manual de calidad', code: 'MAN-GH-001' },
    });

    const result = await generatePdfForDownload({
      idDocument: 10,
      idDocumentVersion: 55,
      contentHtml: '<p>contenido editado</p>',
    });

    expect(result.pdfBuffer).toBeInstanceOf(Buffer);
    expect(result.pdfBuffer.length).toBeGreaterThan(0);
    expect(result.fileName).toBe('MAN-GH-001-v2.pdf');

    // Caso A: no debe tocar OneDrive ni crear/actualizar ningún registro.
    expect(ensureFolderAndUploadFileMock).not.toHaveBeenCalled();
    expect(getMicrosoftTokenMock).not.toHaveBeenCalled();
    expect(prismaMock.documentVersion.update).not.toHaveBeenCalled();
    expect(createDocumentVersionAndStartWorkflowMock).not.toHaveBeenCalled();
  });

  it('rechaza con 404 si la versión no existe', async () => {
    prismaMock.documentVersion.findUnique.mockResolvedValue(null);

    await expect(
      generatePdfForDownload({ idDocument: 10, idDocumentVersion: 999, contentHtml: '<p>x</p>' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rechaza con 404 si la versión pertenece a otro documento', async () => {
    prismaMock.documentVersion.findUnique.mockResolvedValue({
      id_document_version: 55,
      id_document: 999, // no coincide con idDocument pedido
      version_number: 1,
      document: { title: 'x', code: 'X-001' },
    });

    await expect(
      generatePdfForDownload({ idDocument: 10, idDocumentVersion: 55, contentHtml: '<p>x</p>' })
    ).rejects.toBeInstanceOf(EditorError);
  });
});

describe('createNewVersionFromEditorAndStartWorkflow (Caso B -- documento CON proceso)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('crea una versión NUEVA con el número incrementado y arranca el flujo, sin mover current_version_id', async () => {
    prismaMock.document.findUnique.mockResolvedValue({
      id_document: 20,
      code: 'PRO-GH-002',
      title: 'Procedimiento de compras',
      id_company: 3,
      owner_user_id: 'owner-abc',
      company: { company: 'Farmalógica S.A.' },
      documentType: { name: 'Procedimiento' },
    });
    prismaMock.documentVersion.findFirst.mockResolvedValue({ version_number: 2 });
    getMicrosoftTokenMock.mockResolvedValue('fake-token');
    ensureFolderAndUploadFileMock.mockResolvedValue({ id: 'onedrive-item-9' });
    createDocumentVersionAndStartWorkflowMock.mockResolvedValue({
      idDocumentVersion: 8001,
      idRequestGeneral: 7002,
    });

    const result = await createNewVersionFromEditorAndStartWorkflow({
      idDocument: 20,
      contentHtml: '<p>nueva versión</p>',
      actorUserId: 'actor-1',
    });

    // Versión incrementada: última era 2, la nueva debe ser 3 (nunca sobrescribe).
    expect(result.version.version_number).toBe(3);
    expect(result.version.status).toBe(INITIAL_STATE);
    expect(result.version.id_document_version).toBe(8001);
    expect(result.version.id_request_general).toBe(7002);
    expect(result.version.content_html).toBe('<p>nueva versión</p>');

    expect(ensureFolderAndUploadFileMock).toHaveBeenCalledWith(
      'fake-token',
      ['GESTION-DOCUMENTAL', 'Farmalógica S.A', 'Procedimiento', 'PRO-GH-002', 'v3'],
      'PRO-GH-002-v3.pdf',
      expect.any(Uint8Array),
      'application/pdf'
    );

    expect(createDocumentVersionAndStartWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idDocument: 20,
        versionNumber: 3,
        onedriveItemId: 'onedrive-item-9',
        idCompany: 3,
        ownerUserId: 'owner-abc',
        contentHtml: '<p>nueva versión</p>',
      })
    );

    // Crítico (decisión de producto 2026-09-03): el documento vigente NO cambia
    // aquí -- ninguna llamada debe tocar Document.current_version_id.
    expect(prismaMock.documentVersion.update).not.toHaveBeenCalled();
  });

  it('primera versión creada desde el editor sobre un documento sin versiones previas empieza en v1', async () => {
    prismaMock.document.findUnique.mockResolvedValue({
      id_document: 21,
      code: 'PRO-GH-003',
      title: 'Otro procedimiento',
      id_company: 3,
      owner_user_id: 'owner-abc',
      company: { company: 'OLP' },
      documentType: { name: 'Procedimiento' },
    });
    prismaMock.documentVersion.findFirst.mockResolvedValue(null);
    getMicrosoftTokenMock.mockResolvedValue('fake-token');
    ensureFolderAndUploadFileMock.mockResolvedValue({ id: 'onedrive-item-1' });
    createDocumentVersionAndStartWorkflowMock.mockResolvedValue({
      idDocumentVersion: 8002,
      idRequestGeneral: 7003,
    });

    const result = await createNewVersionFromEditorAndStartWorkflow({
      idDocument: 21,
      contentHtml: '<p>v1</p>',
      actorUserId: 'actor-1',
    });

    expect(result.version.version_number).toBe(1);
  });

  it('rechaza con 404 si el documento no existe', async () => {
    prismaMock.document.findUnique.mockResolvedValue(null);

    await expect(
      createNewVersionFromEditorAndStartWorkflow({ idDocument: 999, contentHtml: '<p>x</p>', actorUserId: 'a' })
    ).rejects.toMatchObject({ status: 404 });

    expect(getMicrosoftTokenMock).not.toHaveBeenCalled();
    expect(createDocumentVersionAndStartWorkflowMock).not.toHaveBeenCalled();
  });
});

describe('saveWordUploadContent (carga inicial de contenido convertido desde Word)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockEditableVersion(overrides: Partial<{ content_html: string | null; status: string }>) {
    prismaMock.document.findUnique.mockResolvedValue({
      id_document: 30,
      current_version_id: 55,
      company: { company: 'Farmalógica S.A.' },
      documentType: { name: 'Procedimiento' },
    });
    prismaMock.documentVersion.findUnique.mockResolvedValue({
      id_document_version: 55,
      version_number: 2,
      status: overrides.status ?? INITIAL_STATE,
      content_html: overrides.content_html ?? null,
    });
  }

  it('camino feliz: guarda el HTML convertido cuando la versión no tiene contenido todavía', async () => {
    mockEditableVersion({ content_html: null, status: INITIAL_STATE });
    prismaMock.documentVersion.update.mockResolvedValue({
      id_document_version: 55,
      version_number: 2,
      status: INITIAL_STATE,
      content_html: '<p>convertido de Word</p>',
    });

    const result = await saveWordUploadContent({ idDocument: 30, contentHtml: '<p>convertido de Word</p>' });

    expect(prismaMock.documentVersion.update).toHaveBeenCalledWith({
      where: { id_document_version: 55 },
      data: { content_html: '<p>convertido de Word</p>' },
    });
    expect(result.version.content_html).toBe('<p>convertido de Word</p>');
  });

  it('rechaza con 409 si la versión ya tiene contenido cargado', async () => {
    mockEditableVersion({ content_html: '<p>ya existía</p>', status: INITIAL_STATE });

    await expect(
      saveWordUploadContent({ idDocument: 30, contentHtml: '<p>nuevo</p>' })
    ).rejects.toMatchObject({ status: 409 });
    expect(prismaMock.documentVersion.update).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si la versión ya está Vigente', async () => {
    mockEditableVersion({ content_html: null, status: 'Vigente' });

    await expect(
      saveWordUploadContent({ idDocument: 30, contentHtml: '<p>nuevo</p>' })
    ).rejects.toMatchObject({ status: 409 });
    expect(prismaMock.documentVersion.update).not.toHaveBeenCalled();
  });

  it('rechaza con 409 si la versión está en un estado cerrado (p.ej. Obsoleto)', async () => {
    mockEditableVersion({ content_html: null, status: 'Obsoleto' });

    await expect(
      saveWordUploadContent({ idDocument: 30, contentHtml: '<p>nuevo</p>' })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rechaza con 404 si el documento no existe', async () => {
    prismaMock.document.findUnique.mockResolvedValue(null);

    await expect(
      saveWordUploadContent({ idDocument: 999, contentHtml: '<p>nuevo</p>' })
    ).rejects.toMatchObject({ status: 404 });
  });
});
