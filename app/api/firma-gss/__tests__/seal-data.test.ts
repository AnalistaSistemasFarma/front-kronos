import { beforeEach, describe, expect, it, vi } from 'vitest';

// «Datos del sello» (GSS Firma): solo los PROPIOS, tras reautenticarse, sin valores en la auditoría.

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findFirst: vi.fn(),
  verificar: vi.fn(),
  readSignature: vi.fn(),
  readCurrent: vi.fn(),
  save: vi.fn(),
  saveConsent: vi.fn(),
  auditar: vi.fn(),
  consultar: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { user: { findFirst: m.findFirst } } }));
vi.mock('../../../../lib/auth/verifyPassword', () => ({ synerlinkPasswordVerifier: () => m.verificar }));
vi.mock('../../../../lib/firma-gss/server', () => ({
  sealDataDeps: () => ({
    readSignature: m.readSignature,
    readCurrent: m.readCurrent,
    save: m.save,
    saveConsent: m.saveConsent,
    auditar: m.auditar,
  }),
  getSealData: m.consultar,
}));

import * as ruta from '../datos-sello/route';
import { limiteReautenticacion } from '../../../../lib/bitacora-proceso/firmas';

const EMAIL = 'yo@farmalogica.com';
const DATOS = { fullName: 'Ana María Pérez', idDocumentType: 'CC', idNumber: '1.020.304.050', jobTitle: 'Directora técnica' };
const put = (body: unknown) =>
  new Request('http://x/api/firma-gss/datos-sello', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9:5000', 'user-agent': 'vitest' },
  });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  limiteReautenticacion.limpiar(EMAIL);
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.findFirst.mockResolvedValue({ id: 'u1' });
  m.verificar.mockResolvedValue(true);
  m.readSignature.mockResolvedValue({ dataUrl: 'data:image/png;base64,AA==', method: 'uploaded' });
  m.readCurrent.mockResolvedValue({ fullName: 'Ana María Pérez', idNumber: null, jobTitle: null, idDocumentType: null, hasSigningLegalConsent: false });
  m.save.mockResolvedValue({ ok: true });
  m.saveConsent.mockResolvedValue({ ok: true });
  m.auditar.mockResolvedValue({});
});

describe('Datos del sello (GSS Firma) · ruta', () => {
  it('sin sesión 401; usuario inactivo 403', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await ruta.GET()).status).toBe(401);
    expect((await ruta.PUT(put({}))).status).toBe(401);
    m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
    m.findFirst.mockResolvedValue(null);
    expect((await ruta.PUT(put({}))).status).toBe(403);
  });

  it('GET devuelve los datos de la persona de la SESIÓN, sin caché', async () => {
    m.consultar.mockResolvedValue({ disponible: true, ...DATOS, hasSigningLegalConsent: true });
    const res = await ruta.GET();
    expect(res.status).toBe(200);
    expect(m.consultar).toHaveBeenCalledWith(EMAIL);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('PUT: guarda los PROPIOS tras la contraseña, reenviando la rúbrica registrada, y acepta el consentimiento', async () => {
    const res = await ruta.PUT(put({ ...DATOS, acceptedTerms: true, password: 'secreta' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, consentSaved: true });
    expect(m.verificar).toHaveBeenCalledWith(EMAIL, 'secreta');
    expect(m.save).toHaveBeenCalledWith(EMAIL, 'data:image/png;base64,AA==', 'uploaded', DATOS);
    expect(m.saveConsent).toHaveBeenCalledWith(EMAIL);
  });

  it('PUT: la auditoría dice QUÉ campos cambiaron, nunca los valores (Ley 1581)', async () => {
    await ruta.PUT(put({ ...DATOS, password: 'x' }));
    const row = m.auditar.mock.calls[0][0];
    expect(row).toMatchObject({ user_id: 'u1', action: 'GSS_FIRMA_DATOS_SELLO', performed_by: EMAIL });
    const details = JSON.parse(row.details);
    expect(details.camposCambiados.sort()).toEqual(['idDocumentType', 'idNumber', 'jobTitle']);
    expect(row.details).not.toContain('1.020.304.050');
    expect(row.details).not.toContain('Directora');
    expect(details.ip).toBe('10.0.0.9');
  });

  it('PUT: no vuelve a guardar el consentimiento si ya lo tenía', async () => {
    m.readCurrent.mockResolvedValue({ hasSigningLegalConsent: true });
    const res = await ruta.PUT(put({ ...DATOS, acceptedTerms: true, password: 'x' }));
    expect((await res.json()).consentSaved).toBe(false);
    expect(m.saveConsent).not.toHaveBeenCalled();
  });

  it('PUT: datos de OTRA persona es 403 (el correo nunca sale del cuerpo)', async () => {
    expect((await ruta.PUT(put({ ...DATOS, email: 'otro@farmalogica.com', password: 'x' }))).status).toBe(403);
    expect(m.verificar).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it('PUT: documento y cargo son opcionales; el nombre no', async () => {
    const res = await ruta.PUT(put({ fullName: 'Ana María Pérez', idNumber: '', jobTitle: '', password: 'x' }));
    expect(res.status).toBe(200);
    expect(m.save).toHaveBeenCalledWith(EMAIL, 'data:image/png;base64,AA==', 'uploaded', {
      fullName: 'Ana María Pérez',
      idDocumentType: 'CC',
      idNumber: '',
      jobTitle: '',
    });
    m.save.mockClear();
    m.verificar.mockClear();
    expect((await ruta.PUT(put({ ...DATOS, fullName: '', password: 'x' }))).status).toBe(400);
    expect(m.verificar).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it('PUT: datos inválidos es 400 y no pide contraseña', async () => {
    expect((await ruta.PUT(put({ ...DATOS, idNumber: '12', password: 'x' }))).status).toBe(400);
    expect((await ruta.PUT(put({ ...DATOS, idDocumentType: 'XX', password: 'x' }))).status).toBe(400);
    expect((await ruta.PUT(put({ ...DATOS, idNumber: '12<script>', password: 'x' }))).status).toBe(400);
    expect(m.verificar).not.toHaveBeenCalled();
    expect(m.save).not.toHaveBeenCalled();
  });

  it('PUT: sin contraseña 400; incorrecta 403 sin guardar; a los 5 fallos 429', async () => {
    expect((await ruta.PUT(put(DATOS))).status).toBe(400);
    m.verificar.mockResolvedValue(false);
    for (let i = 0; i < 5; i++) expect((await ruta.PUT(put({ ...DATOS, password: 'mala' }))).status).toBe(403);
    expect(m.save).not.toHaveBeenCalled();
    m.verificar.mockResolvedValue(true);
    expect((await ruta.PUT(put({ ...DATOS, password: 'buena' }))).status).toBe(429);
  });

  it('PUT: sin firma registrada es 409; si GSS Firma falla es 502 sin auditar', async () => {
    m.readSignature.mockResolvedValue({ dataUrl: null, method: null });
    expect((await ruta.PUT(put({ ...DATOS, password: 'x' }))).status).toBe(409);
    expect(m.save).not.toHaveBeenCalled();
    m.readSignature.mockResolvedValue({ dataUrl: 'data:image/png;base64,AA==', method: 'drawn' });
    m.save.mockResolvedValue({ ok: false, error: 'Orión caído' });
    const res = await ruta.PUT(put({ ...DATOS, password: 'x' }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('Orión caído');
    expect(m.auditar).not.toHaveBeenCalled();
  });
});
