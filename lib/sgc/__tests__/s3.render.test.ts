import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sprint 3 — conversión del borrador a PDF (Chrome headless endurecido) y a
 * HTML (mammoth), descarga sin verificar de OneDrive y dependencias reales
 * de la firma. Chrome y mammoth se simulan: se prueba cómo se usan.
 */

const h = vi.hoisted(() => {
  const handlers: ((req: unknown) => void)[] = [];
  const page = {
    setJavaScriptEnabled: vi.fn(async () => undefined),
    setRequestInterception: vi.fn(async () => undefined),
    on: vi.fn((_e: string, cb: (req: unknown) => void) => handlers.push(cb)),
    setContent: vi.fn(async () => undefined),
    pdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
    close: vi.fn(async () => undefined),
  };
  const browser = { newPage: vi.fn(async () => page), close: vi.fn() };
  return {
    handlers,
    page,
    browser,
    launch: vi.fn(async () => browser),
    convertToHtml: vi.fn(async () => ({ value: '<p>Hola <script>x</script>Word</p>' })),
    getToken: vi.fn(async () => 'token'),
    downloadOneDriveItemContent: vi.fn(),
  };
});

vi.mock('puppeteer', () => ({ default: { launch: h.launch } }));
vi.mock('mammoth', () => ({ default: { convertToHtml: h.convertToHtml } }));
vi.mock('../../../components/microsoft-365/useGetMicrosoftToken', () => ({ useGetMicrosoftToken: h.getToken }));
vi.mock('../../onedrive/graphFolderUpload', () => ({ ensureFolderAndUploadFile: vi.fn(), downloadOneDriveItemContent: h.downloadOneDriveItemContent }));
vi.mock('../../prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('../../notifications.js', () => ({ createAndSendNotifications: vi.fn() }));

import { downloadSgcFile } from '../onedrive';
import { docxToHtml, htmlToPdf } from '../pdf/render';
import { sgcSignatureDeps } from '../signature/deps';

describe('SGC · S3 · generador de PDF del borrador (Chrome headless endurecido)', () => {
  beforeEach(() => {
    h.handlers.length = 0;
    h.page.pdf.mockClear();
  });

  it('[SGC-REQ-045][SGC-REQ-048] imprime A4 con JavaScript apagado y bloquea toda petición de red', async () => {
    const pdf = await htmlToPdf('<html><body><p>x</p></body></html>');
    expect(pdf).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(h.page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(h.page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(h.page.pdf).toHaveBeenCalledWith({ format: 'A4', printBackground: true });
    const req = (url: string) => ({ url: () => url, abort: vi.fn(async () => undefined), continue: vi.fn(async () => undefined), isNavigationRequest: () => false });
    const ext = req('https://evil.example/x.png');
    const blank = req('about:blank');
    const data = req('data:image/png;base64,AA==');
    for (const r of [ext, blank, data]) h.handlers[0](r);
    expect(ext.abort).toHaveBeenCalled();
    expect(blank.continue).toHaveBeenCalled();
    expect(data.continue).toHaveBeenCalled();
    expect(h.page.close).toHaveBeenCalled();
    await htmlToPdf('<p>otra</p>');
    expect(h.launch).toHaveBeenCalledTimes(1); // Chrome se reutiliza entre generaciones.
  });

  it('[SGC-REQ-045] si Chrome no arranca, responde 503 y lo reintenta en la siguiente', async () => {
    vi.resetModules();
    h.launch.mockRejectedValueOnce(new Error('sin chrome'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fresh = await import('../pdf/render');
    await expect(fresh.htmlToPdf('<p>x</p>')).rejects.toMatchObject({ status: 503 });
    await expect(fresh.htmlToPdf('<p>x</p>')).resolves.toBeInstanceOf(Uint8Array);
    spy.mockRestore();
  });

  it('[SGC-REQ-047] Word (.docx) → HTML con mammoth, limpio', async () => {
    expect(await docxToHtml(new Uint8Array([80, 75]))).toBe('<p>Hola Word</p>');
    h.convertToHtml.mockResolvedValueOnce({ value: undefined as never });
    expect(await docxToHtml(new Uint8Array([80, 75]))).toBe('');
  });
});

describe('SGC · S3 · OneDrive sin verificar y dependencias reales de la firma', () => {
  it('[SGC-REQ-041] descarga el item tal cual (quien llama compara la huella); sin archivo, 502', async () => {
    h.downloadOneDriveItemContent.mockResolvedValueOnce({ buffer: Buffer.from('abc') });
    expect(await downloadSgcFile('item')).toEqual(new Uint8Array(Buffer.from('abc')));
    h.downloadOneDriveItemContent.mockResolvedValueOnce(null);
    await expect(downloadSgcFile('item')).rejects.toMatchObject({ status: 502 });
  });

  it('[SGC-REQ-049] las dependencias reales no hablan con Orión: contraseña local, OneDrive propio, Chrome local', () => {
    const deps = sgcSignatureDeps();
    expect(Object.keys(deps).sort()).toEqual(['appUrl', 'docxToHtml', 'download', 'htmlToPdf', 'notifier', 'upload', 'verifyPassword']);
    expect(deps.download).toBe(downloadSgcFile);
    expect(deps.appUrl).toBeTruthy();
  });
});
