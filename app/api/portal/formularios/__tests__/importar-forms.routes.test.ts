import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Importar desde Microsoft Forms (Cristian Baldión, 2026-10-09): rutas del servidor.
// Sesión y servicio importador SIMULADOS.

const CRUDO = JSON.parse(readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'lib/portal/__tests__/fixtures/forms-evaluacion-induccion-crudo.json'), 'utf8'));
const FORMADOR = 'formador@gsslatam.com';
const ID = '3f2b8c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const FORMS = 'https://forms.cloud.microsoft/pages/responsepage.aspx?id=abc&route=shorturl';

const { identificar } = vi.hoisted(() => ({ identificar: vi.fn() }));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));

import { NextRequest } from 'next/server';
import { POST as iniciar } from '../importar-forms/route';
import { GET as consultar } from '../importar-forms/[trabajoId]/route';

const post = (body: unknown) =>
  new NextRequest(new URL('/api/portal/formularios/importar-forms', 'http://localhost'), {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
const get = () => new NextRequest(new URL('/api/portal/formularios/importar-forms/' + ID, 'http://localhost'));
const p = (trabajoId: string) => ({ params: Promise.resolve({ trabajoId }) });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  process.env.PORTAL_TH_FORMADORES = FORMADOR;
  process.env.PORTAL_TH_IMPORTADOR_FORMS = 'http://127.0.0.1:3046';
  identificar.mockResolvedValue({ correo: FORMADOR, via: 'codigo' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.PORTAL_TH_IMPORTADOR_FORMS;
});

describe('POST /api/portal/formularios/importar-forms', () => {
  it('sin sesión: 401; sin ser formador: 403 (y no llama al servicio)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    identificar.mockResolvedValue(null);
    expect((await iniciar(post({ url: FORMS }))).status).toBe(401);
    identificar.mockResolvedValue({ correo: 'estudiante@gsslatam.com', via: 'codigo' });
    expect((await iniciar(post({ url: FORMS }))).status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  it('un enlace que no es de Microsoft Forms: 400 y no llega al servicio', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    for (const url of ['https://evil.com/x', 'http://forms.office.com/r/a', 'https://forms.office.com@evil.com/', '', undefined]) {
      expect((await iniciar(post({ url }))).status, String(url)).toBe(400);
    }
    expect((await iniciar(post('esto no es json'))).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('sin importador configurado: 503', async () => {
    delete process.env.PORTAL_TH_IMPORTADOR_FORMS;
    expect((await iniciar(post({ url: FORMS }))).status).toBe(503);
  });

  it('arranca el trabajo y devuelve su id (manda al servicio la URL normalizada)', async () => {
    const f = vi.fn(async () => json(202, { id: ID }));
    vi.stubGlobal('fetch', f);
    const res = await iniciar(post({ url: '  ' + FORMS + '  ' }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ id: ID });
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe('http://127.0.0.1:3046/importar');
    expect(JSON.parse(init.body)).toEqual({ url: FORMS });
  });

  it('servicio caído: 503; saturado: 429; respuesta rara: 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect((await iniciar(post({ url: FORMS }))).status).toBe(503);
    vi.stubGlobal('fetch', vi.fn(async () => json(429, { error: 'x' })));
    expect((await iniciar(post({ url: FORMS }))).status).toBe(429);
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { error: 'boom' })));
    expect((await iniciar(post({ url: FORMS }))).status).toBe(502);
  });
});

describe('GET /api/portal/formularios/importar-forms/:id', () => {
  it('sin sesión: 401; sin ser formador: 403; id inválido: 400', async () => {
    vi.stubGlobal('fetch', vi.fn());
    identificar.mockResolvedValue(null);
    expect((await consultar(get(), p(ID))).status).toBe(401);
    identificar.mockResolvedValue({ correo: 'estudiante@gsslatam.com', via: 'codigo' });
    expect((await consultar(get(), p(ID))).status).toBe(403);
    identificar.mockResolvedValue({ correo: FORMADOR, via: 'codigo' });
    for (const id of ['x', '../../etc/passwd', ID + '/../x', '']) expect((await consultar(get(), p(id))).status, id).toBe(400);
  });

  it('en curso: devuelve el avance real (0-100) y la etapa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { estado: 'en_curso', progreso: 35, etapa: 'Esperando las preguntas' })));
    const res = await consultar(get(), p(ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ estado: 'en_curso', progreso: 35, etapa: 'Esperando las preguntas' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('listo: devuelve el resultado NORMALIZADO, nunca lo bruto del servicio', async () => {
    const sucio = { ...CRUDO, scriptMalicioso: '<script>alert(1)</script>', preguntas: [...CRUDO.preguntas, { titulo: 'Marque varias', tipo: 'multiple', obligatoria: true, opciones: ['a'], extra: 'x' }] };
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { estado: 'listo', progreso: 100, etapa: 'Listo', resultado: sucio })));
    const data = await (await consultar(get(), p(ID))).json();
    expect(data.estado).toBe('listo');
    expect(data.progreso).toBe(100);
    expect(data.resultado.preguntas).toHaveLength(12);
    expect(data.resultado.advertencias).toHaveLength(1);
    expect(JSON.stringify(data)).not.toMatch(/scriptMalicioso|extra|<script>/);
  });

  it('error del servicio: mensaje acotado; progreso fuera de rango se corrige', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { estado: 'error', progreso: 250, etapa: 'Error', error: 'El formulario no es público.' })));
    const data = await (await consultar(get(), p(ID))).json();
    expect(data).toEqual({ estado: 'error', progreso: 100, etapa: 'Error', error: 'El formulario no es público.' });
  });

  it('importación vencida: 404; servicio caído: 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { error: 'x' })));
    expect((await consultar(get(), p(ID))).status).toBe(404);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect((await consultar(get(), p(ID))).status).toBe(503);
  });
});
