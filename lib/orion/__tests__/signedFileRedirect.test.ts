import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * GET /api/integrations/orion/signed-file sin copia firmada en Orion redirige al
 * adjunto de SynerLink. La redirección debe ser RELATIVA: detrás del proxy,
 * req.url trae el origen interno del proceso (https://localhost:3030) y la vista
 * previa del firmante terminaba en "No se puede conectar a localhost:3030".
 */
const session = vi.hoisted(() => vi.fn());
const pool = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({ getServerSession: session }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/mssqlPool', () => ({ withMssqlPool: pool }));
vi.mock('@/lib/orion/client', () => ({ fetchOrionSignedFileContent: vi.fn() }));
vi.mock('@/lib/orion/documentVersions', () => ({
  listOrionDocumentVersions: vi.fn(() => []),
  resolveOrionPdfUrl: vi.fn(),
  canViewOrionDocumentVersions: vi.fn(() => false),
  isOrionDocumentSigner: vi.fn(() => false),
}));
vi.mock('@/lib/orion/formValue', () => ({ getOrionDocumentFromBag: vi.fn(() => null) }));
vi.mock('@/lib/orion/service', () => ({
  getRequestOrionContext: vi.fn(),
  loadOrionFormBag: vi.fn(),
  resolveOriginalPdfBase64: vi.fn(),
  resolveOrionActorUserId: vi.fn(),
  userIsOrionFlowSignatureResponsible: vi.fn(),
}));
vi.mock('@/lib/orion/signedFileAccess', () => ({
  isOrionProtectedFileUrl: vi.fn(() => false),
  isAllowedServerPdfFetchUrl: vi.fn(() => false),
  orionDocumentHasSignedCopy: vi.fn(() => false),
}));
vi.mock('@/lib/orion/stampSynerlinkWatermark', () => ({ stampSynerlinkWatermark: vi.fn() }));
vi.mock('@/lib/orion/validatorMarks', () => ({ applyValidatorMarks: vi.fn() }));
vi.mock('@/lib/orion/validatorStamp', () => ({ buildValidatorMarks: vi.fn() }));

import { GET } from '../../../app/api/integrations/orion/signed-file/route';

const INTERNO = 'https://localhost:3030';

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { email: 'firmante@gsslatam.com', id: 'u1' } });
});

describe('GET /api/integrations/orion/signed-file — sin copia firmada', () => {
  it('redirige al adjunto de SynerLink con Location relativo (no al origen interno)', async () => {
    pool.mockResolvedValue(null); // sin bag Orion → adjunto de SynerLink
    const res = await GET(
      new Request(`${INTERNO}/api/integrations/orion/signed-file?requestId=10079&fileId=01A7LY3DNJCGFUPGBKCNC2L5KLDHWRDM7W`)
    );
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toBe(
      '/api/requests-general/attachment-file?requestId=10079&fileId=01A7LY3DNJCGFUPGBKCNC2L5KLDHWRDM7W'
    );
    expect(location).not.toContain('localhost');
  });

  it('conserva download=1 al forzar la descarga', async () => {
    pool.mockResolvedValue(null);
    const res = await GET(
      new Request(`${INTERNO}/api/integrations/orion/signed-file?requestId=5&fileId=f1&download=1`)
    );
    expect(res.headers.get('location')).toBe(
      '/api/requests-general/attachment-file?requestId=5&fileId=f1&download=1'
    );
  });

  it('documento con bag pero sin firmas (autorizar para firma) también redirige relativo', async () => {
    pool.mockResolvedValue({ state: { orionDocumentId: 'doc-1' }, canViewVersions: false });
    const res = await GET(
      new Request(`${INTERNO}/api/integrations/orion/signed-file?requestId=10079&fileId=abc`)
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      '/api/requests-general/attachment-file?requestId=10079&fileId=abc'
    );
  });
});
