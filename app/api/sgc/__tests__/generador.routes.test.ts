import { beforeEach, describe, expect, it, vi } from 'vitest';

// Generador de documentos (2026-10-05): listado de vigentes, copia de trabajo y
// PDF generado, con la sesión y la base simuladas. Es el único caso del SGC en
// que se descarga, y cada generación y descarga queda en la auditoría.

const m = vi.hoisted(() => {
  const names = ['getServerSession', 'getSgcAccessForUser', 'getAccessSubject', 'listGeneratorDocuments', 'getGeneratorBase', 'generateFromVigente', 'auditCreate'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { sgcAuditLog: { create: m.auditCreate } } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser: m.getSgcAccessForUser }));
vi.mock('../../../../lib/sgc/db/documents', () => ({ getAccessSubject: m.getAccessSubject }));
vi.mock('../../../../lib/sgc/onedrive', () => ({ downloadSgcFile: 'descarga' }));
vi.mock('../../../../lib/sgc/pdf/render', () => ({ docxToHtml: 'docx', htmlToPdf: 'html' }));
vi.mock('../../../../lib/sgc/db/generator', () => ({ listGeneratorDocuments: m.listGeneratorDocuments, getGeneratorBase: m.getGeneratorBase, generateFromVigente: m.generateFromVigente }));

import { SgcError } from '../../../../lib/sgc/errors';
import { canUseSgcGenerator, generatorLegend, generatorSourceFormat } from '../../../../lib/sgc/generator';
import * as list from '../generator/route';
import * as one from '../generator/[id]/route';

const PISA = 1;
const lectura = { idCompany: PISA, companyName: 'PISA', canRead: true, canManage: false, canQuality: false, canAdminFlows: false };
const gestion = { ...lectura, canManage: true };
const EMAIL = 'juan.mora@gsslatam.com';

function asUser(access: object[]) {
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.getSgcAccessForUser.mockResolvedValue(access);
  m.getAccessSubject.mockResolvedValue({ email: EMAIL, departmentIds: [3] });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const H = { 'x-forwarded-for': '10.0.0.8:5555', 'user-agent': 'vitest' };
const post = (body: unknown) => new Request('http://x/', { method: 'POST', body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });
const get = (url: string) => new Request(`http://x${url}`, { headers: H });

const GENERATED = { bytes: new Uint8Array([37, 80, 68, 70]), fileName: 'PISA-DT-MA-001 V1 - generado 202610051030.pdf', document: { id: 6, idCompany: PISA, code: 'PISA-DT-MA-001', versionNumber: 1, idVersion: 6 } };

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

describe('Generador de documentos · reglas', () => {
  it('solo gestión documental o Calidad usan el generador; Word y editor se abren, el PDF no', () => {
    expect(canUseSgcGenerator(lectura)).toBe(false);
    expect(canUseSgcGenerator(gestion)).toBe(true);
    expect(canUseSgcGenerator({ canManage: false, canQuality: true })).toBe(true);
    expect(generatorSourceFormat('PISA-DT-MA-001 V1.docx')).toBe('docx');
    expect(generatorSourceFormat('X V2.html')).toBe('html');
    expect(generatorSourceFormat('X V1.pdf')).toBeNull();
    expect(generatorSourceFormat(null)).toBeNull();
  });

  it('la leyenda cita el documento de origen, la persona y la hora de Colombia', () => {
    expect(generatorLegend({ code: 'PISA-DT-MA-001', versionNumber: 1, user: 'Juan Mora', at: new Date('2026-10-05T15:30:00Z') })).toBe(
      'Documento generado a partir de PISA-DT-MA-001 v1 · Juan Mora · 2026-10-05 10:30 · No es copia controlada'
    );
  });
});

describe('Generador de documentos · rutas', () => {
  it('sin sesión responde 401 y no consulta nada', async () => {
    m.getServerSession.mockResolvedValue(null);
    const all = await Promise.all([list.GET(get('/?company=1')), one.GET(get('/'), params('6')), one.POST(post({ html: '<p>x</p>' }), params('6'))]);
    expect(all.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(m.generateFromVigente).not.toHaveBeenCalled();
  });

  it('el listado exige gestión documental o Calidad', async () => {
    asUser([lectura]);
    expect((await list.GET(get('/?company=1'))).status).toBe(403);
    asUser([gestion]);
    m.listGeneratorDocuments.mockResolvedValue([{ idDocument: 6, code: 'PISA-DT-MA-001', sourceFormat: 'docx' }]);
    const r = await list.GET(get('/?company=1'));
    expect(r.status).toBe(200);
    expect((await r.json()).documents[0].code).toBe('PISA-DT-MA-001');
  });

  it('la copia de trabajo pasa por la capa del SGC con la persona de la sesión y los errores salen con su mensaje', async () => {
    asUser([gestion]);
    m.getGeneratorBase.mockResolvedValueOnce({ html: '<p>Hola</p>' }).mockRejectedValueOnce(new SgcError('La versión vigente solo tiene el PDF controlado', 409));
    const ok = await one.GET(get('/'), params('6'));
    expect(ok.status).toBe(200);
    expect(m.getGeneratorBase.mock.calls[0][4]).toBe(6);
    const ko = await one.GET(get('/'), params('6'));
    expect(ko.status).toBe(409);
  });

  it('«vista» sale inline y «descarga» como adjunto; las dos quedan en la auditoría y no piden motivo', async () => {
    asUser([gestion]);
    m.generateFromVigente.mockResolvedValue(GENERATED);
    const vista = await one.POST(post({ html: '<p>Contenido modificado del manual</p>', modo: 'vista' }), params('6'));
    expect(vista.status).toBe(200);
    expect(vista.headers.get('content-type')).toBe('application/pdf');
    expect(vista.headers.get('content-disposition')).toMatch(/^inline;/);
    const descarga = await one.POST(post({ html: '<p>Contenido modificado del manual</p>', modo: 'descarga' }), params('6'));
    expect(descarga.headers.get('content-disposition')).toMatch(/^attachment;/);
    const actions = m.auditCreate.mock.calls.map((c) => c[0].data.action);
    expect(actions).toEqual(['generador.documento_generado', 'generador.descarga']);
    expect(m.auditCreate.mock.calls[1][0].data.detail).toContain('PISA-DT-MA-001 V1');
    expect(m.generateFromVigente.mock.calls[0][5]).toEqual({ html: '<p>Contenido modificado del manual</p>' });
  });

  it('modo inválido → 400 sin generar', async () => {
    asUser([gestion]);
    const r = await one.POST(post({ html: '<p>x</p>', modo: 'otro' }), params('6'));
    expect(r.status).toBe(400);
    expect(m.generateFromVigente).not.toHaveBeenCalled();
  });
});
