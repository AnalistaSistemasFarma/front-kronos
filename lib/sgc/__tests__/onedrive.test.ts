import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getToken, ensureFolderAndUploadFile, downloadOneDriveItemContent } = vi.hoisted(() => ({
  getToken: vi.fn(),
  ensureFolderAndUploadFile: vi.fn(),
  downloadOneDriveItemContent: vi.fn(),
}));
vi.mock('../../../components/microsoft-365/useGetMicrosoftToken', () => ({ useGetMicrosoftToken: getToken }));
vi.mock('../../onedrive/graphFolderUpload', () => ({ ensureFolderAndUploadFile, downloadOneDriveItemContent }));

import { downloadVerifiedPdf, uploadToSgcStorage } from '../onedrive';
import { sha256Hex } from '../storage';

const bytes = new TextEncoder().encode('%PDF-1.7 contenido');

describe('SGC · OneDrive (utilidad compartida, carpeta propia)', () => {
  beforeEach(() => {
    getToken.mockReset().mockResolvedValue('token');
    ensureFolderAndUploadFile.mockReset();
    downloadOneDriveItemContent.mockReset();
  });

  it('[SGC-REQ-014] sube a la carpeta de la versión con la utilidad compartida', async () => {
    ensureFolderAndUploadFile.mockResolvedValue({ id: 'item-1' });
    await expect(uploadToSgcStorage(['SGC', 'OLP', 'PR', 'X', 'v1'], 'X V1.pdf', bytes, 'application/pdf')).resolves.toEqual({ id: 'item-1' });
    expect(ensureFolderAndUploadFile).toHaveBeenCalledWith('token', ['SGC', 'OLP', 'PR', 'X', 'v1'], 'X V1.pdf', expect.any(Blob), 'application/pdf');
  });

  it('[SGC-REQ-014] sin token de Graph no sube nada', async () => {
    getToken.mockResolvedValue(null);
    await expect(uploadToSgcStorage([], 'x', bytes, 'application/pdf')).rejects.toThrow('token');
  });

  it('[SGC-REQ-017] entrega el PDF solo si su SHA-256 coincide con el registrado', async () => {
    downloadOneDriveItemContent.mockResolvedValue({ buffer: Buffer.from(bytes), contentType: 'application/pdf', fileName: 'x.pdf' });
    await expect(downloadVerifiedPdf('item-1', sha256Hex(bytes).toUpperCase())).resolves.toEqual(bytes);
    await expect(downloadVerifiedPdf('item-1', 'f'.repeat(64))).rejects.toMatchObject({ status: 409 });
  });

  it('[SGC-REQ-017] si OneDrive no entrega el archivo responde 502', async () => {
    downloadOneDriveItemContent.mockResolvedValue(null);
    await expect(downloadVerifiedPdf('item-1', 'x')).rejects.toMatchObject({ status: 502 });
  });
});
