import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Formación — FORMULARIO PROPIO (Cristian Baldión, 2026-10-08): validación de
// obligatorias, envío → completado, permisos para ver respuestas (403),
// exportación a Excel y que nada de las respuestas llegue a los logs.
// Sesión, base y permisos (Excel) SIMULADOS.

const SST = readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'lib/portal/formularios/sst-01-fr-001.json'), 'utf8');
const ESTUDIANTE = 'estudiante@gsslatam.com';
const ADMIN = 'admin.th@gsslatam.com';

const { identificar, puedeVerRespuestasFormulario, recalcularProgresoDeMaterial, prisma } = vi.hoisted(() => {
  const prisma = {
    portalCourseMaterial: { findFirst: vi.fn() },
    portalFormulario: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    portalFormularioVersion: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    portalFormularioRespuesta: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
    portalMaterialProgress: { upsert: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    identificar: vi.fn(),
    puedeVerRespuestasFormulario: vi.fn(),
    recalcularProgresoDeMaterial: vi.fn(),
    prisma,
  };
});

vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/portal/permisos-formacion', async (original) => {
  const real = await original<typeof import('@/lib/portal/permisos-formacion')>();
  return { ...real, puedeVerRespuestasFormulario };
});
vi.mock('@/lib/portal/formacion', () => ({
  recalcularProgresoDeMaterial,
  resolverNombreEstudiante: vi.fn(async () => 'Ana Pérez'),
  contarPaginasPdf: vi.fn(),
  marcarMaterialCompletado: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { GET as abrirFormulario, POST as enviar } from '../[materialId]/formulario/route';
import { GET as verRespuestas } from '../[materialId]/respuestas/route';
import { GET as exportar } from '../[materialId]/respuestas/excel/route';
import { DELETE as reabrir } from '../[materialId]/respuestas/[respuestaId]/route';
import { POST as abrirVista } from '../[materialId]/vista/route';
import { POST as importar } from '../../formularios/route';

const req = (url: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(new URL(url, 'http://localhost'), {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined ? { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
const p = (materialId: string) => ({ params: Promise.resolve({ materialId }) });

const definicion = JSON.parse(SST) as { preguntas: { id: string; tipo: string; obligatoria: boolean; opciones?: string[] }[] };

function respuestasCompletas(): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const q of definicion.preguntas) {
    if (!q.obligatoria) continue;
    if (q.tipo === 'fecha') r[q.id] = '1990-05-17';
    else if (q.tipo === 'seleccion') r[q.id] = q.opciones![0];
    else if (q.tipo === 'si_no') r[q.id] = 'Sí';
    else r[q.id] = 'Respuesta';
  }
  r.p19 = 'O+';
  return r;
}

const MATERIAL_FORM = { id: 4, type: 'FORM', title: 'PERFIL SOCIODEMOGRÁFICO SST', formulario_id: 1, course: { active: true, id: 2, title: 'INDUCCIÓN ORGANIZACIONAL - SST' } };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PORTAL_TH_FORMADORES = 'formador@gsslatam.com';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: ESTUDIANTE, via: 'codigo' });
  puedeVerRespuestasFormulario.mockResolvedValue(false);
  recalcularProgresoDeMaterial.mockResolvedValue({ porcentaje: 25, certificado: null });
  prisma.portalCourseMaterial.findFirst.mockResolvedValue(MATERIAL_FORM);
  prisma.portalFormulario.findUnique.mockResolvedValue({ id: 1, codigo: 'SST-01-FR-001', version_actual: 1 });
  prisma.portalFormularioVersion.findUnique.mockResolvedValue({ id: 10, version: 1, definicion: SST });
  prisma.portalFormularioVersion.findFirst.mockResolvedValue({ id: 10, definicion: SST });
  prisma.portalFormularioRespuesta.findUnique.mockResolvedValue(null);
  prisma.portalFormularioRespuesta.create.mockResolvedValue({ id: 99 });
  prisma.portalMaterialProgress.upsert.mockResolvedValue({ id: 1 });
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof prisma) => unknown)(prisma)
  );
});

describe('responder — GET/POST /api/portal/materials/:id/formulario', () => {
  it('sin sesión: 401', async () => {
    identificar.mockResolvedValue(null);
    expect((await abrirFormulario(req('/api/portal/materials/4/formulario'), p('4'))).status).toBe(401);
    expect((await enviar(req('/api/portal/materials/4/formulario', { method: 'POST', body: {} }), p('4'))).status).toBe(401);
  });

  it('abre la definición vigente con correo y nombre de la sesión, sin respuestas de nadie', async () => {
    const res = await abrirFormulario(req('/api/portal/materials/4/formulario'), p('4'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.formulario.versionId).toBe(10);
    expect(data.formulario.definicion.preguntas).toHaveLength(40);
    expect(data.prellenado).toEqual({ correo: ESTUDIANTE, nombre: 'Ana Pérez' });
    expect(data.enviadaEl).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/respuestas"/);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('un material que no es formulario: 404', async () => {
    prisma.portalCourseMaterial.findFirst.mockResolvedValue({ ...MATERIAL_FORM, type: 'LINK', formulario_id: null });
    expect((await abrirFormulario(req('/api/portal/materials/4/formulario'), p('4'))).status).toBe(404);
  });

  it('faltan obligatorias: 422 con la lista por pregunta, y NO guarda ni completa', async () => {
    const r = respuestasCompletas();
    delete r.p19;
    delete r.p40;
    const res = await enviar(req('/api/portal/materials/4/formulario', { method: 'POST', body: { versionId: 10, autorizaDatos: true, respuestas: r } }), p('4'));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.errores.map((e: { id: string }) => e.id)).toEqual(['p19', 'p40']);
    expect(prisma.portalFormularioRespuesta.create).not.toHaveBeenCalled();
    expect(prisma.portalMaterialProgress.upsert).not.toHaveBeenCalled();
  });

  it('sin aceptar la autorización de datos (Ley 1581): 422 y no guarda', async () => {
    const res = await enviar(
      req('/api/portal/materials/4/formulario', { method: 'POST', body: { versionId: 10, autorizaDatos: false, respuestas: respuestasCompletas() } }),
      p('4')
    );
    expect(res.status).toBe(422);
    expect((await res.json()).errores[0].id).toBe('autorizacion');
    expect(prisma.portalFormularioRespuesta.create).not.toHaveBeenCalled();
  });

  it('envío válido → guarda la respuesta y COMPLETA el material (AUTO) en la misma transacción', async () => {
    const respuestas = { ...respuestasCompletas(), p01: 'otra.persona@gmail.com' };
    const res = await enviar(
      req('/api/portal/materials/4/formulario', { method: 'POST', body: { versionId: 10, autorizaDatos: true, respuestas } }),
      p('4')
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, completado: true, porcentaje: 25 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const creada = prisma.portalFormularioRespuesta.create.mock.calls[0][0].data;
    expect(creada).toMatchObject({ material_id: 4, formulario_version_id: 10, student_email: ESTUDIANTE, autorizacion_version: 'AUT-DATOS-SST-2026-10-08-BORRADOR' });
    expect(creada.autorizado_at).toBeInstanceOf(Date);
    // El correo guardado es el de la SESIÓN, no el que se escribió.
    expect(JSON.parse(creada.respuestas).p01).toBe(ESTUDIANTE);

    expect(prisma.portalMaterialProgress.upsert.mock.calls[0][0].create).toMatchObject({ material_id: 4, student_email: ESTUDIANTE, origen: 'AUTO' });
    expect(recalcularProgresoDeMaterial).toHaveBeenCalledWith(4, ESTUDIANTE);
  });

  it('se envía UNA sola vez: el segundo envío responde 409', async () => {
    prisma.portalFormularioRespuesta.findUnique.mockResolvedValue({ id: 99 });
    const res = await enviar(req('/api/portal/materials/4/formulario', { method: 'POST', body: { versionId: 10, autorizaDatos: true, respuestas: respuestasCompletas() } }), p('4'));
    expect(res.status).toBe(409);
    expect(prisma.portalFormularioRespuesta.create).not.toHaveBeenCalled();
  });

  it('dos envíos simultáneos: el índice único (P2002) también da 409', async () => {
    prisma.$transaction.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    const res = await enviar(req('/api/portal/materials/4/formulario', { method: 'POST', body: { versionId: 10, autorizaDatos: true, respuestas: respuestasCompletas() } }), p('4'));
    expect(res.status).toBe(409);
  });

  it('versión de OTRO formulario: 409 y no guarda', async () => {
    prisma.portalFormularioVersion.findFirst.mockResolvedValue(null);
    const res = await enviar(req('/api/portal/materials/4/formulario', { method: 'POST', body: { versionId: 77, autorizaDatos: true, respuestas: respuestasCompletas() } }), p('4'));
    expect(res.status).toBe(409);
    expect(prisma.portalFormularioRespuesta.create).not.toHaveBeenCalled();
  });

  it('si la base falla, el log NO trae las respuestas (datos sensibles)', async () => {
    prisma.$transaction.mockRejectedValue(new Error('Invalid `prisma.create()` invocation: { respuestas: "{\\"p19\\":\\"O+\\",\\"p10\\":\\"SI\\"}" }'));
    const res = await enviar(req('/api/portal/materials/4/formulario', { method: 'POST', body: { versionId: 10, autorizaDatos: true, respuestas: respuestasCompletas() } }), p('4'));
    expect(res.status).toBe(500);
    const registrado = JSON.stringify((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls);
    expect(registrado).not.toMatch(/O\+|p19|respuestas/);
    expect(registrado).toMatch(/POST \.\.\.\/materials\/\[materialId\]\/formulario: Error/);
  });

  it('abrir un formulario por la ruta de "vista" NO lo completa (409)', async () => {
    prisma.portalCourseMaterial.findFirst.mockResolvedValue({ id: 4, type: 'FORM', mime: null, sp_drive_item_id: null, file_size: null, course: { active: true } });
    const res = await abrirVista(req('/api/portal/materials/4/vista', { method: 'POST' }), p('4'));
    expect(res.status).toBe(409);
    expect(prisma.portalMaterialProgress.upsert).not.toHaveBeenCalled();
  });
});

describe('respuestas — solo ADMINISTRADORES y FORMADORES del Excel de permisos', () => {
  const fila = {
    id: 99,
    student_email: ESTUDIANTE,
    enviada_at: new Date('2026-10-08T21:00:00Z'),
    respuestas: JSON.stringify({ p01: ESTUDIANTE, p19: 'O+', p06: { otra: 'Prefiero describirlo' }, p02: '=HYPERLINK("http://x")' }),
    autorizacion_version: 'AUT-DATOS-SST-2026-10-08-BORRADOR',
    autorizado_at: new Date('2026-10-08T21:00:00Z'),
    version: { id: 10, version: 1, definicion: SST },
  };

  beforeEach(() => {
    prisma.portalFormularioRespuesta.findMany.mockResolvedValue([fila]);
  });

  it('sin sesión: 401', async () => {
    identificar.mockResolvedValue(null);
    expect((await verRespuestas(req('/api/portal/materials/4/respuestas'), p('4'))).status).toBe(401);
    expect((await exportar(req('/api/portal/materials/4/respuestas/excel'), p('4'))).status).toBe(401);
  });

  it('estudiante (o formador del portal que NO está en el Excel): 403 y no se consulta nada', async () => {
    identificar.mockResolvedValue({ correo: 'formador@gsslatam.com', via: 'synerlink' });
    const res = await verRespuestas(req('/api/portal/materials/4/respuestas'), p('4'));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/administradores y formadores/);
    expect(prisma.portalFormularioRespuesta.findMany).not.toHaveBeenCalled();
    expect((await exportar(req('/api/portal/materials/4/respuestas/excel'), p('4'))).status).toBe(403);
    expect((await reabrir(req('/api/portal/materials/4/respuestas/99', { method: 'DELETE' }), { params: Promise.resolve({ materialId: '4', respuestaId: '99' }) })).status).toBe(403);
    expect(prisma.portalFormularioRespuesta.delete).not.toHaveBeenCalled();
  });

  it('administrador/formador del Excel: tabla con 40 columnas y la fila', async () => {
    identificar.mockResolvedValue({ correo: ADMIN, via: 'synerlink' });
    puedeVerRespuestasFormulario.mockResolvedValue(true);
    const res = await verRespuestas(req('/api/portal/materials/4/respuestas'), p('4'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const data = await res.json();
    expect(data.columnas).toHaveLength(40);
    expect(data.filas[0]).toMatchObject({ correo: ESTUDIANTE, respuestas: { p19: 'O+' } });
    expect(data.curso).toEqual({ id: 2, titulo: 'INDUCCIÓN ORGANIZACIONAL - SST' });
  });

  it('exportación a Excel: .xlsx con encabezados, la fila, "Otra" y fórmulas neutralizadas', async () => {
    identificar.mockResolvedValue({ correo: ADMIN, via: 'synerlink' });
    puedeVerRespuestasFormulario.mockResolvedValue(true);
    const res = await exportar(req('/api/portal/materials/4/respuestas/excel'), p('4'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="SST-01-FR-001-respuestas-curso-2-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const hoja = libro.getWorksheet('Respuestas')!;
    expect(hoja.rowCount).toBe(2);
    const cabecera = hoja.getRow(1).values as string[];
    expect(cabecera[1]).toBe('Correo (sesión)');
    expect(cabecera[6]).toBe('1. CORREO');
    expect(cabecera[45]).toBe('40. INFORMACIÓN EN CASO DE EMERGENCIA(NOMBRE,CELULAR, PARENTESCO)');
    const valores = hoja.getRow(2).values as string[];
    expect(valores[1]).toBe(ESTUDIANTE);
    expect(valores[7]).toBe(`'=HYPERLINK("http://x")`);
    expect(valores[11]).toBe('Otra: Prefiero describirlo');
    expect(valores[24]).toBe('O+');
  });

  it('reabrir: borra la respuesta y la marca de completado de esa persona', async () => {
    identificar.mockResolvedValue({ correo: ADMIN, via: 'synerlink' });
    puedeVerRespuestasFormulario.mockResolvedValue(true);
    prisma.portalFormularioRespuesta.findFirst.mockResolvedValue({ id: 99, student_email: ESTUDIANTE });
    const res = await reabrir(req('/api/portal/materials/4/respuestas/99', { method: 'DELETE' }), { params: Promise.resolve({ materialId: '4', respuestaId: '99' }) });
    expect(res.status).toBe(200);
    expect(prisma.portalFormularioRespuesta.delete).toHaveBeenCalledWith({ where: { id: 99 } });
    expect(prisma.portalMaterialProgress.deleteMany).toHaveBeenCalledWith({ where: { material_id: 4, student_email: ESTUDIANTE } });
  });
});

describe('importar formularios — POST /api/portal/formularios (formadores del portal)', () => {
  it('quien no es formador: 403', async () => {
    const res = await importar(req('/api/portal/formularios', { method: 'POST', body: SST }));
    expect(res.status).toBe(403);
  });

  it('definición inválida: 400 con la lista de errores', async () => {
    identificar.mockResolvedValue({ correo: 'formador@gsslatam.com', via: 'synerlink' });
    const res = await importar(req('/api/portal/formularios', { method: 'POST', body: { formato: 1, codigo: 'X', titulo: 'X', preguntas: [] } }));
    expect(res.status).toBe(400);
    expect((await res.json()).errores.length).toBeGreaterThan(0);
  });

  it('código repetido: 409', async () => {
    identificar.mockResolvedValue({ correo: 'formador@gsslatam.com', via: 'synerlink' });
    const res = await importar(req('/api/portal/formularios', { method: 'POST', body: SST }));
    expect(res.status).toBe(409);
  });

  it('formador con definición válida: crea el formulario con su versión 1', async () => {
    identificar.mockResolvedValue({ correo: 'formador@gsslatam.com', via: 'synerlink' });
    prisma.portalFormulario.findUnique.mockResolvedValue(null);
    prisma.portalFormulario.create.mockResolvedValue({ id: 2, codigo: 'SST-01-FR-001', titulo: 'T', version_actual: 1 });
    const res = await importar(req('/api/portal/formularios', { method: 'POST', body: SST }));
    expect(res.status).toBe(200);
    expect(prisma.portalFormularioVersion.create.mock.calls[0][0].data).toMatchObject({ formulario_id: 2, version: 1, created_by: 'formador@gsslatam.com' });
  });
});
