import { beforeEach, describe, expect, it, vi } from 'vitest';

// «Mi firma» (GSS Firma): solo la PROPIA, tras reautenticarse, con imagen saneada y auditoría.

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findFirst: vi.fn(),
  verificar: vi.fn(),
  guardar: vi.fn(),
  auditar: vi.fn(),
  consultar: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { user: { findFirst: m.findFirst } } }));
vi.mock('../../../../lib/auth/verifyPassword', () => ({ synerlinkPasswordVerifier: () => m.verificar }));
vi.mock('../../../../lib/firma-gss/server', () => ({
  firmaGssDeps: () => ({ guardar: m.guardar, auditar: m.auditar }),
  consultarFirmaGss: m.consultar,
}));

import * as ruta from '../mi-firma/route';
import { codificarPng } from '../../../../lib/firma-gss/png';
import { limiteReautenticacion } from '../../../../lib/bitacora-proceso/firmas';

const EMAIL = 'yo@farmalogica.com';
function firmaPng(): string {
  const rgba = new Uint8Array(4 * 4 * 4).fill(255);
  rgba.set([0, 0, 0, 255], 20);
  return `data:image/png;base64,${codificarPng({ width: 4, height: 4, rgba }).toString('base64')}`;
}
const post = (body: unknown) =>
  new Request('http://x/api/firma-gss/mi-firma', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9:5000', 'user-agent': 'vitest' } });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  limiteReautenticacion.limpiar(EMAIL);
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.findFirst.mockResolvedValue({ id: 'u1' });
  m.verificar.mockResolvedValue(true);
  m.guardar.mockResolvedValue({ ok: true });
  m.auditar.mockResolvedValue({});
});

describe('Mi firma (GSS Firma) · ruta', () => {
  it('sin sesión 401; usuario inactivo 403', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await ruta.GET()).status).toBe(401);
    expect((await ruta.POST(post({}))).status).toBe(401);
    m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
    m.findFirst.mockResolvedValue(null);
    expect((await ruta.POST(post({}))).status).toBe(403);
  });

  it('GET devuelve la firma de la persona de la SESIÓN', async () => {
    m.consultar.mockResolvedValue({ disponible: true, hasSignature: true, dataUrl: 'data:image/png;base64,AA==', method: 'uploaded' });
    const res = await ruta.GET();
    expect(res.status).toBe(200);
    expect(m.consultar).toHaveBeenCalledWith(EMAIL);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('POST: registra la PROPIA tras la contraseña, saneada, en el maestro del correo de la sesión y auditada', async () => {
    const res = await ruta.POST(post({ imagen: firmaPng(), metodo: 'uploaded', password: 'secreta' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, hasSignature: true, method: 'uploaded' });
    expect(JSON.stringify(body)).not.toContain('secreta');
    expect(m.verificar).toHaveBeenCalledWith(EMAIL, 'secreta');
    expect(m.guardar).toHaveBeenCalledWith(EMAIL, body.dataUrl, 'uploaded');
    const row = m.auditar.mock.calls[0][0];
    expect(row).toMatchObject({ user_id: 'u1', action: 'GSS_FIRMA_REGISTRADA', performed_by: EMAIL });
    expect(JSON.parse(row.details)).toMatchObject({ origen: 'perfil', metodo: 'uploaded', ip: '10.0.0.9' });
  });

  it('POST: la firma de OTRA persona es 403 (el correo nunca sale del cuerpo)', async () => {
    const res = await ruta.POST(post({ email: 'otro@farmalogica.com', imagen: firmaPng(), metodo: 'drawn', password: 'x' }));
    expect(res.status).toBe(403);
    expect(m.verificar).not.toHaveBeenCalled();
    expect(m.guardar).not.toHaveBeenCalled();
    // El mismo correo (con otro uso de mayúsculas) sí es la propia.
    expect((await ruta.POST(post({ email: 'YO@farmalogica.com', imagen: firmaPng(), metodo: 'drawn', password: 'x' }))).status).toBe(201);
  });

  it('POST: sin contraseña 400; contraseña incorrecta 403 sin guardar; a los 5 fallos 429', async () => {
    expect((await ruta.POST(post({ imagen: firmaPng(), metodo: 'drawn' }))).status).toBe(400);
    m.verificar.mockResolvedValue(false);
    for (let i = 0; i < 5; i++) expect((await ruta.POST(post({ imagen: firmaPng(), metodo: 'drawn', password: 'mala' }))).status).toBe(403);
    expect(m.guardar).not.toHaveBeenCalled();
    expect(m.auditar).not.toHaveBeenCalled();
    m.verificar.mockResolvedValue(true);
    expect((await ruta.POST(post({ imagen: firmaPng(), metodo: 'drawn', password: 'buena' }))).status).toBe(429);
  });

  it('POST: imagen no válida (SVG, JPEG disfrazado, método tipográfico) es 400 y no se guarda', async () => {
    expect((await ruta.POST(post({ imagen: 'data:image/svg+xml;base64,PHN2Zz4=', metodo: 'uploaded', password: 'x' }))).status).toBe(400);
    expect((await ruta.POST(post({ imagen: `data:image/png;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]).toString('base64')}`, metodo: 'uploaded', password: 'x' }))).status).toBe(400);
    expect((await ruta.POST(post({ imagen: firmaPng(), metodo: 'tipografica', password: 'x' }))).status).toBe(400);
    expect((await ruta.POST(post('texto'))).status).toBe(400);
    expect(m.guardar).not.toHaveBeenCalled();
  });

  it('POST: si GSS Firma no la guarda, 502 con el motivo (queda auditado el intento)', async () => {
    m.guardar.mockResolvedValue({ ok: false, error: 'Orión caído' });
    const res = await ruta.POST(post({ imagen: firmaPng(), metodo: 'drawn', password: 'x' }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('Orión caído');
    expect(JSON.parse(m.auditar.mock.calls[0][0].details).guardadaEnGssFirma).toBe(false);
  });
});
