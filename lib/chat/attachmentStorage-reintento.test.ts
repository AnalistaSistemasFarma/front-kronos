import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/microsoft-365/useGetMicrosoftToken', () => ({ useGetMicrosoftToken: vi.fn() }));
vi.mock('../onedrive/graphFolderUpload', () => ({ ensureFolderAndUploadFile: vi.fn() }));

import { conReintento } from './attachmentStorage';

const sinEspera = async () => undefined;
const res = (status: number) => new Response('x', { status });

describe('conReintento (descarga de adjuntos desde OneDrive)', () => {
  it('reintenta si la red falla y devuelve la respuesta buena', async () => {
    const pedir = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(res(200));
    const r = await conReintento(pedir, [1, 1], sinEspera);
    expect(r.status).toBe(200);
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it('reintenta 503 y devuelve la última respuesta si sigue fallando', async () => {
    const pedir = vi.fn<() => Promise<Response>>().mockImplementation(async () => res(503));
    const r = await conReintento(pedir, [1, 1], sinEspera);
    expect(r.status).toBe(503);
    expect(pedir).toHaveBeenCalledTimes(3);
  });

  it('no reintenta un 404', async () => {
    const pedir = vi.fn<() => Promise<Response>>().mockImplementation(async () => res(404));
    const r = await conReintento(pedir, [1, 1], sinEspera);
    expect(r.status).toBe(404);
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it('relanza si todos los intentos fallan por red', async () => {
    const pedir = vi.fn<() => Promise<Response>>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(conReintento(pedir, [1, 1], sinEspera)).rejects.toThrow('fetch failed');
    expect(pedir).toHaveBeenCalledTimes(3);
  });
});
