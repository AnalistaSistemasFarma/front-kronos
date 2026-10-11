import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del Sprint 4 (/api/sgc/**: divulgación, lectura obligatoria,
// capacitación, verificación por QR y personas por cargo) con la sesión y la
// base simuladas. Las reglas van en lib/sgc/__tests__ y, contra un SQL
// Server real, en tests/integration/sgc/divulgacion.integration.test.ts.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'companyOfRequest',
    'addScopeEntry', 'removeScopeEntry', 'sendReadingReminders', 'excludeReader', 'closeDissemination',
    'openReadingFile', 'recordReadingEvent', 'downloadVerifiedPdf', 'stampControlledCopy',
    'saveTraining', 'uploadTrainingResults', 'verifyVersionByCode', 'listCargoMembers', 'addCargoMember', 'deactivateCargoMember',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/notifications', () => ({ sgcNotifier: 'notifier' }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ uploadToSgcStorage: 'upload', downloadVerifiedPdf: m.downloadVerifiedPdf }));
vi.mock('../../../../lib/sgc/watermark', () => ({ stampControlledCopy: m.stampControlledCopy }));
vi.mock('../../../../lib/sgc/db/requests', () => ({ companyOfRequest: m.companyOfRequest, excludeReader: m.excludeReader, closeDissemination: m.closeDissemination }));
vi.mock('../../../../lib/sgc/db/dissemination', () => ({ addScopeEntry: m.addScopeEntry, removeScopeEntry: m.removeScopeEntry, sendReadingReminders: m.sendReadingReminders, openReadingFile: m.openReadingFile, recordReadingEvent: m.recordReadingEvent }));
vi.mock('../../../../lib/sgc/db/training', () => ({ saveTraining: m.saveTraining, uploadTrainingResults: m.uploadTrainingResults }));
vi.mock('../../../../lib/sgc/db/verify', () => ({ verifyVersionByCode: m.verifyVersionByCode }));
vi.mock('../../../../lib/sgc/db/cargoMembers', () => ({ listCargoMembers: m.listCargoMembers, addCargoMember: m.addCargoMember, deactivateCargoMember: m.deactivateCargoMember }));

import { SgcError } from '../../../../lib/sgc/errors';
import * as dissemination from '../requests/[id]/dissemination/route';
import * as training from '../requests/[id]/training/route';
import * as results from '../requests/[id]/training/results/route';
import * as readingFile from '../reading/[id]/file/route';
import * as readingProgress from '../reading/[id]/progress/route';
import * as verify from '../verify/route';
import * as cargos from '../cargo-members/route';
import * as cargoOff from '../cargo-members/[id]/deactivate/route';

const OLP = 3;
const lectura = { idCompany: OLP, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const calidad = { ...lectura, canQuality: true };
const EMAIL = 'qa.sgc@gsslatam.com';
const ACTOR = { email: EMAIL, ip: '10.0.0.7', userAgent: 'vitest' };

function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [3] });
}
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const req = (url: string, body?: unknown, method = 'POST') =>
  new Request(`http://x${url}`, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.7:4444', 'user-agent': 'vitest' } });
const get = (url: string) => new Request(`http://x${url}`, { headers: { 'x-forwarded-for': '10.0.0.7:4444', 'user-agent': 'vitest' } });
const multipart = (file?: File) => {
  const form = new FormData();
  if (file) form.append('file', file);
  return new Request('http://x/', { method: 'POST', body: form, headers: { 'x-forwarded-for': '10.0.0.7:4444', 'user-agent': 'vitest' } });
};

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Rutas S4 · sesión obligatoria', () => {
  it('[SGC-REQ-007] sin sesión todas las rutas del S4 responden 401', async () => {
    m.getServerSession.mockResolvedValue(null);
    const p1 = params({ id: '1' });
    const all = await Promise.all([
      dissemination.POST(req('/', {}), p1), training.POST(req('/', {}), p1), results.POST(multipart(), p1),
      readingFile.GET(get('/'), p1), readingProgress.POST(req('/', {}), p1), verify.GET(get('/')),
      cargos.GET(get('/?company=3')), cargos.POST(req('/', {})), cargoOff.POST(req('/', {}), p1),
    ]);
    expect(all.map((r) => r.status)).toEqual(all.map(() => 401));
  });
});

describe('Rutas S4 · divulgación', () => {
  it('[SGC-REQ-053][SGC-REQ-057] cada acción de la divulgación va a su regla con el acceso de la empresa y el origen de la sesión', async () => {
    asUser([calidad]);
    m.companyOfRequest.mockResolvedValue(OLP);
    m.addScopeEntry.mockResolvedValue({ idScope: 1, added: 2 });
    m.removeScopeEntry.mockResolvedValue({ ok: true });
    m.sendReadingReminders.mockResolvedValue({ sent: 3 });
    m.excludeReader.mockResolvedValue({ excluded: 'a@b.co' });
    m.closeDissemination.mockResolvedValue({ read: 4 });
    const p = params({ id: '8' });
    const add = await dissemination.POST(req('/', { action: 'agregar', entry: { kind: 'empresa' }, reason: 'Aplica a todos' }), p);
    expect(add.status).toBe(201);
    expect(m.addScopeEntry).toHaveBeenCalledWith(expect.anything(), 'notifier', calidad, 8, expect.objectContaining({ action: 'agregar' }), ACTOR);
    expect((await dissemination.POST(req('/', { action: 'retirar', idScope: 4, reason: 'Ya no aplica' }), p)).status).toBe(200);
    expect(m.removeScopeEntry).toHaveBeenCalledWith(expect.anything(), calidad, 8, 4, expect.anything(), ACTOR);
    expect(await (await dissemination.POST(req('/', { action: 'recordatorio' }), p)).json()).toEqual({ sent: 3 });
    await dissemination.POST(req('/', { action: 'excluir', idReadRecord: 5, reason: 'Se retiró de la empresa' }), p);
    expect(m.excludeReader).toHaveBeenCalledWith(expect.anything(), 'notifier', calidad, 8, 5, { reason: 'Se retiró de la empresa' }, ACTOR);
    await dissemination.POST(req('/', { action: 'cerrar', reason: 'Cobertura suficiente según Calidad' }), p);
    expect(m.closeDissemination).toHaveBeenCalledWith(expect.anything(), 'notifier', calidad, 8, { reason: 'Cobertura suficiente según Calidad' }, ACTOR);
    expect((await dissemination.POST(req('/', { action: 'borrar' }), p)).status).toBe(400);
    expect((await dissemination.POST(req('/', { action: 'x' }), params({ id: 'x' }))).status).toBe(400);
    m.companyOfRequest.mockResolvedValue(99);
    expect((await dissemination.POST(req('/', { action: 'recordatorio' }), p)).status).toBe(404);
  });

  it('[SGC-REQ-057] un error de negocio sale con su mensaje; uno interno, 500 sin detalle', async () => {
    asUser([lectura]);
    m.companyOfRequest.mockResolvedValue(OLP);
    m.sendReadingReminders.mockRejectedValue(new SgcError('Solo Aseguramiento de Calidad envía recordatorios de lectura.', 403));
    const r = await dissemination.POST(req('/', { action: 'recordatorio' }), params({ id: '8' }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/Calidad/);
    m.sendReadingReminders.mockRejectedValue(new Error('boom interno'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const e = await dissemination.POST(req('/', { action: 'recordatorio' }), params({ id: '8' }));
    spy.mockRestore();
    expect(e.status).toBe(500);
    expect(JSON.stringify(await e.json())).not.toContain('boom');
  });
});

describe('Rutas S4 · lectura obligatoria', () => {
  it('[SGC-REQ-054][SGC-REQ-062] el archivo de lectura sale del servidor verificado y estampado, inline y sin caché, solo para la persona', async () => {
    asUser([lectura]);
    m.openReadingFile.mockResolvedValue({ itemId: 'it-1', sha256: 'f'.repeat(64), code: 'OLP-GC-PR-001', versionNumber: 2, state: 'divulgacion' });
    m.downloadVerifiedPdf.mockResolvedValue(new Uint8Array([1, 2]));
    m.stampControlledCopy.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const r = await readingFile.GET(get('/'), params({ id: '12' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(m.openReadingFile).toHaveBeenCalledWith(expect.anything(), 12, { email: EMAIL, access: [lectura] }, ACTOR);
    expect(m.downloadVerifiedPdf).toHaveBeenCalledWith('it-1', 'f'.repeat(64));
    expect(m.stampControlledCopy).toHaveBeenCalledWith(expect.any(Uint8Array), expect.objectContaining({ viewerEmail: EMAIL, state: 'divulgacion', mode: 'consulta' }));
    expect((await readingFile.GET(get('/'), params({ id: '0' }))).status).toBe(400);
    m.openReadingFile.mockRejectedValue(new SgcError('Lectura no encontrada.', 404));
    expect((await readingFile.GET(get('/'), params({ id: '12' }))).status).toBe(404);
  });

  it('[SGC-REQ-055] el avance de lectura («llegó al final») lo registra el servidor para la persona de la sesión', async () => {
    asUser([lectura]);
    m.recordReadingEvent.mockResolvedValue({ status: 'pendiente', reachedEndAt: '2026-10-01T15:00:00.000Z' });
    const r = await readingProgress.POST(req('/', { event: 'final', pages: 3 }), params({ id: '12' }));
    expect(await r.json()).toMatchObject({ reachedEndAt: '2026-10-01T15:00:00.000Z' });
    expect(m.recordReadingEvent).toHaveBeenCalledWith(expect.anything(), 12, { event: 'final', pages: 3 }, { email: EMAIL, access: [lectura] }, ACTOR);
    expect((await readingProgress.POST(new Request('http://x', { method: 'POST', body: 'no' }), params({ id: '12' }))).status).toBe(400);
    m.recordReadingEvent.mockRejectedValue(new SgcError('Abra el documento antes de registrar la lectura.', 409));
    expect((await readingProgress.POST(req('/', { event: 'final' }), params({ id: '12' }))).status).toBe(409);
  });
});

describe('Rutas S4 · capacitación', () => {
  it('[SGC-REQ-058] registrar la capacitación pasa el acceso de la empresa; sin acceso, 404', async () => {
    asUser([calidad]);
    m.companyOfRequest.mockResolvedValue(OLP);
    m.saveTraining.mockResolvedValue({ idTraining: 1 });
    const body = { mode: 'video', title: 'Capacitación', videoUrl: 'https://v', formsUrl: 'https://f', maxScore: 10 };
    expect(await (await training.POST(req('/', body), params({ id: '8' }))).json()).toEqual({ idTraining: 1 });
    expect(m.saveTraining).toHaveBeenCalledWith(expect.anything(), calidad, 8, body, ACTOR);
    expect((await training.POST(req('/', body), params({ id: 'x' }))).status).toBe(400);
    m.companyOfRequest.mockResolvedValue(99);
    expect((await training.POST(req('/', body), params({ id: '8' }))).status).toBe(404);
  });

  it('[SGC-REQ-059] el Excel de resultados llega como archivo y se entrega con su nombre y bytes a la regla', async () => {
    asUser([calidad]);
    m.companyOfRequest.mockResolvedValue(OLP);
    m.uploadTrainingResults.mockResolvedValue({ idTrainingUpload: 3, sha256: 'a'.repeat(64) });
    const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'resultados.xlsx');
    const r = await results.POST(multipart(file), params({ id: '8' }));
    expect(r.status).toBe(201);
    expect(m.uploadTrainingResults).toHaveBeenCalledWith(expect.anything(), 'upload', calidad, 8, { fileName: 'resultados.xlsx', bytes: expect.any(Uint8Array) }, ACTOR);
    expect((await results.POST(multipart(), params({ id: '8' }))).status).toBe(400);
    m.companyOfRequest.mockResolvedValue(99);
    expect((await results.POST(multipart(file), params({ id: '8' }))).status).toBe(404);
  });
});

describe('Rutas S4 · verificación por QR y personas por cargo', () => {
  it('[SGC-REQ-063] la verificación toma empresa, código y versión de la URL del QR', async () => {
    asUser([lectura]);
    m.verifyVersionByCode.mockResolvedValue({ verdict: 'vigente' });
    const r = await verify.GET(get('/api/sgc/verify?empresa=3&codigo=OLP-GC-PR-001&version=2'));
    expect(await r.json()).toEqual({ verdict: 'vigente' });
    expect(m.verifyVersionByCode).toHaveBeenCalledWith(expect.anything(), [lectura], { email: EMAIL, departmentIds: [3] }, { idCompany: '3', code: 'OLP-GC-PR-001', versionNumber: '2' }, ACTOR);
    m.verifyVersionByCode.mockRejectedValue(new SgcError('No tiene acceso al SGC de esa empresa.', 404));
    expect((await verify.GET(get('/api/sgc/verify?empresa=9'))).status).toBe(404);
  });

  it('[SGC-REQ-064] personas por cargo: consulta cualquiera con acceso; registrar y retirar, solo Calidad', async () => {
    asUser([lectura]);
    m.listCargoMembers.mockResolvedValue({ cargos: [], members: [] });
    expect((await cargos.GET(get('/?company=3'))).status).toBe(200);
    expect((await cargos.GET(get('/'))).status).toBe(400);
    expect((await cargos.GET(get('/?company=9'))).status).toBe(403);
    expect((await cargos.POST(req('/', { company: 3, idCargo: 1, email: 'a@b.co', reason: 'Inducción' }))).status).toBe(403);
    expect((await cargoOff.POST(req('/', { company: 3, reason: 'Retiro' }), params({ id: '4' }))).status).toBe(403);
    asUser([calidad]);
    m.addCargoMember.mockResolvedValue({ id: 5 });
    m.deactivateCargoMember.mockResolvedValue({ ok: true });
    expect((await cargos.POST(req('/', { company: 3, idCargo: 1, email: 'a@b.co', reason: 'Inducción' }))).status).toBe(201);
    expect(m.addCargoMember).toHaveBeenCalledWith(expect.anything(), 3, expect.objectContaining({ idCargo: 1 }), ACTOR);
    expect((await cargoOff.POST(req('/', { company: 3, reason: 'Retiro' }), params({ id: '4' }))).status).toBe(200);
    expect(m.deactivateCargoMember).toHaveBeenCalledWith(expect.anything(), 3, 4, expect.objectContaining({ reason: 'Retiro' }), ACTOR);
    expect((await cargos.POST(req('/', { idCargo: 1 }))).status).toBe(400);
    expect((await cargoOff.POST(req('/', { reason: 'x' }), params({ id: '4' }))).status).toBe(400);
    m.addCargoMember.mockRejectedValue(new SgcError('La persona ya está registrada en ese cargo.', 409));
    expect((await cargos.POST(req('/', { company: 3, idCargo: 1, email: 'a@b.co', reason: 'Inducción' }))).status).toBe(409);
    m.deactivateCargoMember.mockRejectedValue(new SgcError('Registro no encontrado.', 404));
    expect((await cargoOff.POST(req('/', { company: 3, reason: 'Retiro' }), params({ id: '4' }))).status).toBe(404);
    m.listCargoMembers.mockRejectedValue(new SgcError('x', 409));
    expect((await cargos.GET(get('/?company=3'))).status).toBe(409);
  });
});
