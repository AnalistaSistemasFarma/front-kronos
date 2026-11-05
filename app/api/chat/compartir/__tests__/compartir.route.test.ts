import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/chat/compartir — respaldo del share_target de Android cuando el
// service worker no interceptó: sesión obligatoria, tipos y tamaños del chat.

const m = vi.hoisted(() => ({ resolveSessionUser: vi.fn() }));

vi.mock('../../../../../lib/chat/http', () => ({
  resolveSessionUser: m.resolveSessionUser,
  serverError: (_: string, e: unknown) => {
    throw e;
  },
}));

import { POST } from '../route';

const MB = 1024 * 1024;

function compartir(campos: Record<string, string>, archivos: File[] = []): Request {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.append(k, v);
  for (const f of archivos) form.append('files', f);
  return new Request('http://interno:3000/api/chat/compartir', { method: 'POST', body: form });
}

function archivo(nombre: string, bytes: number, tipo = 'application/octet-stream'): File {
  return new File([new Uint8Array(bytes)], nombre, { type: tipo });
}

function destino(res: Response): URL {
  expect(res.status).toBe(303);
  const loc = res.headers.get('location') ?? '';
  // Siempre relativo: detrás de IIS el host de request.url es el interno.
  expect(loc.startsWith('/')).toBe(true);
  return new URL(loc, 'https://synerlink.test');
}

describe('POST /api/chat/compartir', () => {
  beforeEach(() => {
    m.resolveSessionUser.mockReset();
    m.resolveSessionUser.mockResolvedValue({ id: 'u1', email: 'u1@gsslatam.com' });
  });

  it('sin sesión manda al login SIN leer el cuerpo y vuelve a la pantalla', async () => {
    m.resolveSessionUser.mockResolvedValue(null);
    const req = compartir({ text: 'hola' }, [archivo('acta.pdf', 1000, 'application/pdf')]);
    const leer = vi.spyOn(req, 'formData');
    const url = destino(await POST(req));
    expect(leer).not.toHaveBeenCalled();
    expect(url.pathname).toBe('/login');
    const vuelta = new URL(url.searchParams.get('callbackUrl') ?? '', 'https://synerlink.test');
    expect(vuelta.pathname).toBe('/process/chat/compartir');
    expect(vuelta.searchParams.get('aviso')).toBe('sin-sw');
  });

  it('con sesión y solo texto abre la pantalla con title/text/url', async () => {
    const url = destino(await POST(compartir({ title: 'T', text: 'cuerpo', url: 'https://b.co' })));
    expect(url.pathname).toBe('/process/chat/compartir');
    expect(url.searchParams.get('title')).toBe('T');
    expect(url.searchParams.get('aviso')).toBeNull();
    expect(url.searchParams.get('error')).toBeNull();
  });

  it('descarta enlaces que no son http(s)', async () => {
    const url = destino(await POST(compartir({ url: 'javascript:alert(1)' })));
    expect(url.searchParams.get('url')).toBeNull();
  });

  it('ignora la entrada de archivo vacía que Android manda con solo texto', async () => {
    const url = destino(await POST(compartir({ text: 'x' }, [new File([], '')])));
    expect(url.searchParams.get('error')).toBeNull();
    expect(url.searchParams.get('aviso')).toBeNull();
  });

  it('rechaza ejecutables por extensión aunque el tipo diga imagen', async () => {
    const url = destino(await POST(compartir({}, [archivo('foto.exe', 10, 'image/png')])));
    expect(url.searchParams.get('error')).toMatch(/\.exe/);
  });

  it('rechaza archivos de más de 25 MB', async () => {
    const url = destino(await POST(compartir({}, [archivo('video.mp4', 25 * MB + 1, 'video/mp4')])));
    expect(url.searchParams.get('error')).toMatch(/máximo/);
  });

  it('rechaza más de 5 archivos', async () => {
    const seis = Array.from({ length: 6 }, (_, i) => archivo(`f${i}.png`, 10, 'image/png'));
    const url = destino(await POST(compartir({}, seis)));
    expect(url.searchParams.get('error')).toMatch(/máximo 5/);
  });

  it('archivos válidos que el service worker no guardó: pide repetir', async () => {
    const url = destino(await POST(compartir({ text: 'acta' }, [archivo('acta.pdf', 1000, 'application/pdf')])));
    expect(url.searchParams.get('aviso')).toBe('sin-sw');
    expect(url.searchParams.get('text')).toBe('acta');
  });

  it('un cuerpo que no es multipart cae en el aviso de recepción', async () => {
    const res = await POST(
      new Request('http://x/api/chat/compartir', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
    );
    expect(destino(res).searchParams.get('aviso')).toBe('recepcion');
  });
});
