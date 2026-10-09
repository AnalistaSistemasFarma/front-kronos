import { beforeEach, describe, expect, it, vi } from 'vitest';

// Formación — EVALUACIÓN (Cristian Baldión, 2026-10-09): el servidor califica, las
// respuestas correctas NUNCA salen hacia el estudiante, el intento reprobado no
// completa el material y se puede reintentar. Sesión y base SIMULADAS.

const ESTUDIANTE = 'estudiante@gsslatam.com';

const EVALUACION = JSON.stringify({
  formato: 1,
  codigo: 'EVA-INDUCCION-SST',
  titulo: 'Evaluación Inducción',
  tipo: 'evaluacion',
  notaMinima: 80,
  datosSensibles: true,
  autorizacion: { version: 'AUT-1', titulo: 'Aviso', texto: ['Texto'], casilla: 'Acepto' },
  preguntas: [
    { id: 'nombre', texto: 'Nombre completo', tipo: 'texto', obligatoria: true, prellenar: 'nombre' },
    { id: 'cedula', texto: 'Número de cédula', tipo: 'texto', obligatoria: true },
    ...Array.from({ length: 10 }, (_, i) => ({
      id: 'q' + (i + 1),
      texto: 'Pregunta ' + (i + 1),
      tipo: 'seleccion',
      obligatoria: true,
      opciones: ['correcta', 'incorrecta', 'otra'],
      puntos: 10,
      correcta: 0,
    })),
  ],
});

const { identificar, recalcularProgresoDeMaterial, prisma } = vi.hoisted(() => {
  const prisma = {
    portalCourseMaterial: { findFirst: vi.fn() },
    portalFormulario: { findUnique: vi.fn() },
    portalFormularioVersion: { findUnique: vi.fn(), findFirst: vi.fn() },
    portalFormularioRespuesta: { findUnique: vi.fn(), create: vi.fn() },
    portalFormularioIntento: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    portalMaterialProgress: { upsert: vi.fn() },
    $transaction: vi.fn(),
  };
  return { identificar: vi.fn(), recalcularProgresoDeMaterial: vi.fn(), prisma };
});

vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/portal/formacion', () => ({
  recalcularProgresoDeMaterial,
  resolverNombreEstudiante: vi.fn(async () => 'Ana Pérez'),
  contarPaginasPdf: vi.fn(),
  marcarMaterialCompletado: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { GET as abrir, POST as enviar } from '../[materialId]/formulario/route';

const req = (url: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(new URL(url, 'http://localhost'), {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
const p = (materialId: string) => ({ params: Promise.resolve({ materialId }) });
const URL_FORM = '/api/portal/materials/4/formulario';

const MATERIAL_FORM = { id: 4, type: 'FORM', title: 'EVALUACIÓN', formulario_id: 7, course: { active: true, id: 2, title: 'INDUCCIÓN' } };

/** Respuestas con `malas` preguntas incorrectas (las primeras). */
function respuestas(malas: number): Record<string, unknown> {
  const r: Record<string, unknown> = { nombre: 'Ana Pérez', cedula: '1.234.567' };
  for (let i = 1; i <= 10; i++) r['q' + i] = i <= malas ? 'incorrecta' : 'correcta';
  return r;
}
const cuerpo = (r: Record<string, unknown>) => ({ method: 'POST', body: { versionId: 20, autorizaDatos: true, respuestas: r } });

function definicionConEstado(extra: Record<string, unknown>) {
  return JSON.stringify({ ...JSON.parse(EVALUACION), ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PORTAL_TH_FORMADORES = 'formador@gsslatam.com';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: ESTUDIANTE, via: 'codigo' });
  recalcularProgresoDeMaterial.mockResolvedValue({ porcentaje: 50, certificado: null });
  prisma.portalCourseMaterial.findFirst.mockResolvedValue(MATERIAL_FORM);
  prisma.portalFormulario.findUnique.mockResolvedValue({ id: 7, codigo: 'EVA-INDUCCION-SST', version_actual: 1 });
  prisma.portalFormularioVersion.findUnique.mockResolvedValue({ id: 20, version: 1, definicion: EVALUACION });
  prisma.portalFormularioVersion.findFirst.mockResolvedValue({ id: 20, definicion: EVALUACION });
  prisma.portalFormularioRespuesta.findUnique.mockResolvedValue(null);
  prisma.portalFormularioRespuesta.create.mockResolvedValue({ id: 99 });
  prisma.portalFormularioIntento.create.mockResolvedValue({ id: 5 });
  prisma.portalFormularioIntento.findMany.mockResolvedValue([]);
  prisma.portalFormularioIntento.count.mockResolvedValue(1);
  prisma.portalMaterialProgress.upsert.mockResolvedValue({ id: 1 });
  prisma.$transaction.mockImplementation(async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof prisma) => unknown)(prisma)));
});

describe('evaluación — abrir (GET)', () => {
  it('NUNCA devuelve las respuestas correctas al estudiante, pero sí los puntos y la nota mínima', async () => {
    const res = await abrir(req(URL_FORM), p('4'));
    expect(res.status).toBe(200);
    const texto = await res.text();
    // La clave `correcta` no existe en lo que recibe el estudiante.
    expect(texto).not.toMatch(/"correcta":/);
    const data = JSON.parse(texto);
    expect(data.formulario.definicion).toMatchObject({ tipo: 'evaluacion', notaMinima: 80 });
    expect(data.formulario.definicion.preguntas[2]).toMatchObject({ id: 'q1', puntos: 10 });
    expect(data.intentos).toEqual({ usados: 0, ultimo: null });
  });

  it('informa cuántos intentos lleva y la última nota', async () => {
    prisma.portalFormularioIntento.findMany.mockResolvedValue([
      { porcentaje: 70, aprobado: false, enviado_at: new Date('2026-10-09T15:00:00Z') },
      { porcentaje: 40, aprobado: false, enviado_at: new Date('2026-10-09T14:00:00Z') },
    ]);
    const data = await (await abrir(req(URL_FORM), p('4'))).json();
    expect(data.intentos.usados).toBe(2);
    expect(data.intentos.ultimo).toMatchObject({ porcentaje: 70, aprobado: false });
  });

  it('una evaluación en borrador no se abre: 409', async () => {
    prisma.portalFormularioVersion.findUnique.mockResolvedValue({ id: 20, version: 1, definicion: definicionConEstado({ borrador: true }) });
    const res = await abrir(req(URL_FORM), p('4'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/en preparación/);
  });
});

describe('evaluación — enviar (POST)', () => {
  it('aprueba con todas correctas: guarda intento y respuesta, completa el material y devuelve la nota', async () => {
    const res = await enviar(req(URL_FORM, cuerpo(respuestas(0))), p('4'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, completado: true, evaluacion: { porcentaje: 100, aprobado: true, notaMinima: 80 } });
    expect(prisma.portalFormularioIntento.create.mock.calls[0][0].data).toMatchObject({
      material_id: 4,
      formulario_version_id: 20,
      student_email: ESTUDIANTE,
      puntaje: 100,
      puntaje_max: 100,
      porcentaje: 100,
      aprobado: true,
    });
    expect(prisma.portalFormularioRespuesta.create).toHaveBeenCalledTimes(1);
    expect(prisma.portalMaterialProgress.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('exactamente la nota mínima (80 %) aprueba', async () => {
    const res = await enviar(req(URL_FORM, cuerpo(respuestas(2))), p('4'));
    expect((await res.json()).evaluacion).toMatchObject({ porcentaje: 80, aprobado: true });
  });

  it('reprueba: guarda SOLO el intento, NO crea la respuesta ni completa el material, y permite reintentar', async () => {
    prisma.portalFormularioIntento.count.mockResolvedValue(1);
    const res = await enviar(req(URL_FORM, cuerpo(respuestas(3))), p('4'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, completado: false, evaluacion: { porcentaje: 70, aprobado: false, notaMinima: 80, intentos: 1 } });
    expect(prisma.portalFormularioIntento.create).toHaveBeenCalledTimes(1);
    expect(prisma.portalFormularioIntento.create.mock.calls[0][0].data).toMatchObject({ porcentaje: 70, aprobado: false });
    expect(prisma.portalFormularioRespuesta.create).not.toHaveBeenCalled();
    expect(prisma.portalMaterialProgress.upsert).not.toHaveBeenCalled();
    expect(recalcularProgresoDeMaterial).not.toHaveBeenCalled();
    // No revela cuáles preguntas falló ni cuáles son las correctas.
    expect(JSON.stringify(data)).not.toMatch(/correcta|q1|errores/);
  });

  it('después de reprobar, un segundo intento aprobado completa el material', async () => {
    await enviar(req(URL_FORM, cuerpo(respuestas(5))), p('4'));
    expect(prisma.portalFormularioRespuesta.create).not.toHaveBeenCalled();
    const res = await enviar(req(URL_FORM, cuerpo(respuestas(0))), p('4'));
    expect((await res.json()).completado).toBe(true);
    expect(prisma.portalFormularioIntento.create).toHaveBeenCalledTimes(2);
    expect(prisma.portalFormularioRespuesta.create).toHaveBeenCalledTimes(1);
  });

  it('el estudiante no puede declararse la nota: se ignoran "puntaje", "porcentaje" y "aprobado" del cuerpo', async () => {
    const res = await enviar(
      req(URL_FORM, { method: 'POST', body: { versionId: 20, autorizaDatos: true, respuestas: respuestas(8), porcentaje: 100, aprobado: true, puntaje: 100 } }),
      p('4')
    );
    expect((await res.json()).evaluacion).toMatchObject({ porcentaje: 20, aprobado: false });
  });

  it('faltan preguntas: 422 y no se guarda ni un intento', async () => {
    const r = respuestas(0);
    delete r.q3;
    delete r.cedula;
    const res = await enviar(req(URL_FORM, cuerpo(r)), p('4'));
    expect(res.status).toBe(422);
    expect((await res.json()).errores.map((e: { id: string }) => e.id)).toEqual(['cedula', 'q3']);
    expect(prisma.portalFormularioIntento.create).not.toHaveBeenCalled();
  });

  it('en borrador: 409 y no guarda nada', async () => {
    prisma.portalFormularioVersion.findFirst.mockResolvedValue({ id: 20, definicion: definicionConEstado({ borrador: true }) });
    const res = await enviar(req(URL_FORM, cuerpo(respuestas(0))), p('4'));
    expect(res.status).toBe(409);
    expect(prisma.portalFormularioIntento.create).not.toHaveBeenCalled();
  });

  it('ya aprobada (respuesta existente): 409 sin guardar otro intento', async () => {
    prisma.portalFormularioRespuesta.findUnique.mockResolvedValue({ id: 99 });
    const res = await enviar(req(URL_FORM, cuerpo(respuestas(0))), p('4'));
    expect(res.status).toBe(409);
    expect(prisma.portalFormularioIntento.create).not.toHaveBeenCalled();
  });

  it('no escribe las respuestas en los logs si la base falla', async () => {
    prisma.$transaction.mockRejectedValue(Object.assign(new Error('Invalid prisma invocation: cedula 1.234.567'), { name: 'PrismaClientKnownRequestError', code: 'P2010' }));
    const res = await enviar(req(URL_FORM, cuerpo(respuestas(0))), p('4'));
    expect(res.status).toBe(500);
    const registrado = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(registrado).not.toContain('1.234.567');
  });
});
