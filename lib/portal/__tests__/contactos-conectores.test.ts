import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Correos Corporativos: las 9 empresas, con Bioselect y Farmadosis configurables
// por variable de entorno igual que Abamia, Meditrack y Kelab (Cristian, 2026-10-09).

const SOLO_NUEVAS = {
  PORTAL_TH_CONECTOR_ABAMIA: 'http://127.0.0.1:3041/mcp',
  PORTAL_TH_CONECTOR_MEDITRACK: 'http://127.0.0.1:3042/mcp',
  PORTAL_TH_CONECTOR_KELAB: 'http://127.0.0.1:3043/mcp',
  PORTAL_TH_CONECTOR_BIOSELECT: 'http://127.0.0.1:3044/mcp',
  PORTAL_TH_CONECTOR_FARMADOSIS: 'http://127.0.0.1:3045/mcp',
};

function respuestaMcp(usuarios: { nombre: string; correo: string }[]) {
  const sobre = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ usuarios }) }] } };
  return new Response('data: ' + JSON.stringify(sobre) + '\n', { status: 200 });
}

async function cargar() {
  vi.resetModules();
  return import('../contactos');
}

describe('leerCorreosCorporativos: conectores por tenant', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sin variables, Bioselect y Farmadosis quedan sin_acceso (no se omiten)', async () => {
    const fetchMock = vi.fn(async () => respuestaMcp([]));
    vi.stubGlobal('fetch', fetchMock);
    for (const k of Object.keys(SOLO_NUEVAS)) vi.stubEnv(k, '');
    // '' no es null: se borra de verdad para simular "sin configurar".
    for (const k of Object.keys(SOLO_NUEVAS)) delete process.env[k];

    const { leerCorreosCorporativos } = await cargar();
    const grupos = await leerCorreosCorporativos();

    const por = Object.fromEntries(grupos.map((g) => [g.empresa, g.estado]));
    expect(por.BIOSELECT).toBe('sin_acceso');
    expect(por.FARMADOSIS).toBe('sin_acceso');
    expect(grupos).toHaveLength(9);
  });

  it('con variables, consulta cada conector y devuelve sus usuarios', async () => {
    const porUrl: Record<string, { nombre: string; correo: string }[]> = {
      'http://127.0.0.1:3044/mcp': [{ nombre: 'Ana Bio', correo: 'ana@bioselect.com.co' }],
      'http://127.0.0.1:3045/mcp': [{ nombre: 'Luis Dosis', correo: 'luis@farmadosis.com.co' }],
    };
    const fetchMock = vi.fn(async (url: string) => respuestaMcp(porUrl[url] ?? []));
    vi.stubGlobal('fetch', fetchMock);
    for (const [k, v] of Object.entries(SOLO_NUEVAS)) vi.stubEnv(k, v);

    const { leerCorreosCorporativos } = await cargar();
    const grupos = await leerCorreosCorporativos();

    const bio = grupos.find((g) => g.empresa === 'BIOSELECT');
    const far = grupos.find((g) => g.empresa === 'FARMADOSIS');
    expect(bio).toMatchObject({ estado: 'ok', usuarios: [{ correo: 'ana@bioselect.com.co' }] });
    expect(far).toMatchObject({ estado: 'ok', usuarios: [{ correo: 'luis@farmadosis.com.co' }] });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3044/mcp', expect.anything());
  });

  it('si un conector falla, esa empresa queda sin_acceso y las demás se ven', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith(':3042/mcp') ? new Response('x', { status: 500 }) : respuestaMcp([{ nombre: 'U', correo: 'u@x.com' }])
    );
    vi.stubGlobal('fetch', fetchMock);
    for (const [k, v] of Object.entries(SOLO_NUEVAS)) vi.stubEnv(k, v);

    const { leerCorreosCorporativos } = await cargar();
    const grupos = await leerCorreosCorporativos();

    expect(grupos.find((g) => g.empresa === 'MEDITRACK')?.estado).toBe('sin_acceso');
    expect(grupos.find((g) => g.empresa === 'KELAB')?.estado).toBe('ok');
  });
});
