import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { AnotacionInvalida, dibujarAnotaciones, leerAnotaciones, normalizarAnotaciones, MAX_ANOTACIONES } from '../anotaciones';
import { closeRegistro, createRegistro, getRegistro, listFormatos, listRegistros, pdfRegistro, saveAnotaciones, saveFormato, vigenciaDe } from '../db';
import { getBiomedAccessForUser, BIOMED_SUBPROCESS_URL } from '../access';

/**
 * INGENIERÍA BIOMÉDICA (2026-11-06; reunión con Juan Mora del 2026-11-05):
 * formatos vigentes del SGC diligenciados encima del PDF; el CONTROL bloquea un
 * borrador cuyo formato dejó de estar vigente.
 */

const engineer = { idCompany: 3, companyName: 'OLP', canUse: true, canConfigure: false };
const calidad = { ...engineer, canConfigure: true };
const actor = { email: 'Ingeniero@OLP.com', ip: '10.0.0.1' };

async function pdfVacio() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595.28, 841.89]).drawText('REPORTE DE MANTENIMIENTO', { x: 50, y: 800, size: 12, font });
  pdf.addPage([595.28, 841.89]).drawText('Página 2', { x: 50, y: 800, size: 12, font });
  return pdf.save();
}

/** Base simulada: un formato FR vigente (V2) y su registro. */
function fakeDb(opts: { docStatus?: string; currentVersion?: number; versionStatus?: string } = {}) {
  const st = {
    formatos: [{ id_biomed_formato: 1, id_company: 3, id_document: 10, actividad: 'Mantenimientos (preventivo, correctivo, metrológico)', is_active: true }],
    registros: [] as Record<string, unknown>[],
    eventos: [] as { accion: string }[],
  };
  const doc = { id_document: 10, id_company: 3, code: 'OLP-IB-FR-001', title: 'Reporte de mantenimiento', status: opts.docStatus ?? 'vigente', current_version_id: opts.currentVersion ?? 22 };
  const versions: Record<number, { id_document_version: number; version_number: number; status: string; pdf_item_id: string; pdf_sha256: string; document: { code: string } }> = {
    22: { id_document_version: 22, version_number: 2, status: opts.versionStatus ?? 'vigente', pdf_item_id: 'od-22', pdf_sha256: 'a'.repeat(64), document: { code: doc.code } },
    21: { id_document_version: 21, version_number: 1, status: 'obsoleto', pdf_item_id: 'od-21', pdf_sha256: 'b'.repeat(64), document: { code: doc.code } },
  };
  const db = {
    st,
    sgcDocument: {
      findUnique: vi.fn(async () => doc),
      findFirst: vi.fn(async ({ where }: { where: { id_document: number } }) => (where.id_document === 10 ? doc : null)),
      findMany: vi.fn(async () => [doc]),
    },
    sgcDocumentVersion: {
      findUnique: vi.fn(async ({ where }: { where: { id_document_version: number } }) => versions[where.id_document_version] ?? null),
      findMany: vi.fn(async ({ where }: { where: { id_document_version: { in: number[] } } }) => where.id_document_version.in.map((i) => versions[i]).filter(Boolean)),
    },
    biomedFormato: {
      findMany: vi.fn(async () => st.formatos),
      findFirst: vi.fn(async ({ where }: { where: { id_biomed_formato: number } }) => st.formatos.find((f) => f.id_biomed_formato === where.id_biomed_formato && f.is_active) ?? null),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ id_biomed_formato: 2, ...create })),
    },
    biomedRegistro: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id_biomed_registro: st.registros.length + 1, estado: 'borrador', data_json: '[]', created_at: new Date('2026-11-06T15:00:00Z'), closed_at: null, ...data };
        st.registros.push(row);
        return row;
      }),
      findMany: vi.fn(async () => st.registros.map((r) => ({ ...r, formato: st.formatos[0] }))),
      findFirst: vi.fn(async ({ where }: { where: { id_biomed_registro: number } }) => {
        const r = st.registros.find((x) => x.id_biomed_registro === where.id_biomed_registro);
        return r ? { ...r, formato: st.formatos[0] } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id_biomed_registro: number }; data: Record<string, unknown> }) => {
        const r = st.registros.find((x) => x.id_biomed_registro === where.id_biomed_registro)!;
        Object.assign(r, data);
        return r;
      }),
    },
    biomedEvento: { create: vi.fn(async ({ data }: { data: { accion: string } }) => st.eventos.push(data)) },
  };
  return db;
}

describe('Ingeniería biomédica · anotaciones', () => {
  it('valida lo que llega del navegador (texto con fuente fija o marca X, dentro de la página)', () => {
    const ok = normalizarAnotaciones([
      { id: 'a1', tipo: 'texto', page: 1, x: 10.123, y: 20, texto: 'Bomba de infusión\nSin novedad', negrilla: true, fuente: 'Comic Sans', tamano: 30 },
      { id: 'a2', tipo: 'marca', page: 2, x: 50, y: 60 },
    ]);
    expect(ok).toEqual([
      { id: 'a1', tipo: 'texto', page: 1, x: 10.12, y: 20, texto: 'Bomba de infusión\nSin novedad', negrilla: true },
      { id: 'a2', tipo: 'marca', page: 2, x: 50, y: 60 },
    ]);
    expect(() => normalizarAnotaciones('x')).toThrow(AnotacionInvalida);
    expect(() => normalizarAnotaciones([{ id: 'a', tipo: 'texto', page: 1, x: 120, y: 1, texto: 'x' }])).toThrow(/dentro de la página/);
    expect(() => normalizarAnotaciones([{ id: 'a', tipo: 'firma', page: 1, x: 1, y: 1 }])).toThrow(/texto o marca/);
    expect(() => normalizarAnotaciones([{ id: 'a', tipo: 'marca', page: 3, x: 1, y: 1 }], 2)).toThrow(/página/);
    expect(() => normalizarAnotaciones([{ id: 'a', tipo: 'marca', page: 1, x: 1, y: 1 }, { id: 'a', tipo: 'marca', page: 1, x: 2, y: 2 }])).toThrow(/único/);
    expect(() => normalizarAnotaciones([{ id: '<x>', tipo: 'marca', page: 1, x: 1, y: 1 }])).toThrow(/identificador/);
    expect(() => normalizarAnotaciones(Array.from({ length: MAX_ANOTACIONES + 1 }, (_, i) => ({ id: `a${i}`, tipo: 'marca', page: 1, x: 1, y: 1 })))).toThrow(/Máximo/);
    expect(normalizarAnotaciones([{ id: 'a', tipo: 'texto', page: 1, x: 1, y: 1, texto: 'x'.repeat(500) }])[0]).toMatchObject({ texto: 'x'.repeat(300) });
    expect(leerAnotaciones('{roto')).toEqual([]);
    expect(leerAnotaciones(null)).toEqual([]);
  });

  it('las dibuja encima del PDF sin cambiar sus páginas', async () => {
    const out = await dibujarAnotaciones(await pdfVacio(), normalizarAnotaciones([
      { id: 'a1', tipo: 'texto', page: 1, x: 10, y: 20, texto: 'Línea 1\nLínea 2 — ñ', negrilla: false },
      { id: 'a2', tipo: 'marca', page: 2, x: 50, y: 60 },
      { id: 'a3', tipo: 'marca', page: 9, x: 50, y: 60 },
    ]));
    const pdf = await PDFDocument.load(out);
    expect(pdf.getPageCount()).toBe(2);
    expect(out.length).toBeGreaterThan((await pdfVacio()).length);
  });
});

describe('Ingeniería biomédica · formatos, registros y control de vigencia', () => {
  it('solo Calidad habilita formatos, y solo vigentes', async () => {
    const db = fakeDb();
    await expect(saveFormato(db as never, engineer, { idDocument: 10, actividad: 'Visita técnica' }, actor)).rejects.toMatchObject({ status: 403 });
    await expect(saveFormato(db as never, calidad, { idDocument: 99, actividad: 'Visita técnica' }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(saveFormato(db as never, calidad, { idDocument: 10, actividad: 'x' }, actor)).rejects.toThrow(/actividad/);
    expect(await saveFormato(db as never, calidad, { idDocument: 10, actividad: 'Visita técnica' }, actor)).toEqual({ id: 2 });
    expect(db.st.eventos.at(-1)).toMatchObject({ accion: 'formato.habilitado' });
    const obsoleto = fakeDb({ docStatus: 'obsoleto' });
    await expect(saveFormato(obsoleto as never, calidad, { idDocument: 10, actividad: 'Visita técnica' }, actor)).rejects.toThrow(/no está vigente/);
    expect(await saveFormato(obsoleto as never, calidad, { idDocument: 10, actividad: 'Visita técnica', isActive: false }, actor)).toEqual({ id: 2 });
    const lista = await listFormatos(db as never, calidad);
    expect(lista[0]).toMatchObject({ code: 'OLP-IB-FR-001', vigente: { idVersion: 22, versionNumber: 2 } });
  });

  it('se diligencia sobre la versión vigente, se guarda, se cierra y queda como evidencia', async () => {
    const db = fakeDb();
    await expect(createRegistro(db as never, engineer, { idFormato: 1, equipo: 'x' }, actor)).rejects.toThrow(/equipo/);
    await expect(createRegistro(db as never, engineer, { idFormato: 99, equipo: 'Bomba' }, actor)).rejects.toMatchObject({ status: 404 });
    const { id } = await createRegistro(db as never, engineer, { idFormato: 1, equipo: 'Bomba de infusión Mindray', serial: 'SN-123' }, actor);
    expect(db.st.registros[0]).toMatchObject({ id_document_version: 22, equipo: 'Bomba de infusión Mindray', serial: 'SN-123', created_by: 'ingeniero@olp.com' });
    await expect(closeRegistro(db as never, engineer, id, actor)).rejects.toThrow(/vacío/);
    expect(await saveAnotaciones(db as never, engineer, id, [{ id: 'a1', tipo: 'marca', page: 1, x: 10, y: 10 }], actor)).toEqual({ saved: 1 });
    await expect(saveAnotaciones(db as never, engineer, id, [{ id: 'a1', tipo: 'otra' }], { email: 'otro@olp.com' })).rejects.toMatchObject({ status: 403 });
    const det = await getRegistro(db as never, engineer, id, actor.email);
    expect(det).toMatchObject({ estado: 'borrador', puedeEditar: true, bloqueado: false, motivoBloqueo: null, anotaciones: [{ id: 'a1' }] });
    expect(await closeRegistro(db as never, engineer, id, actor)).toEqual({ closed: true });
    await expect(saveAnotaciones(db as never, engineer, id, [], actor)).rejects.toThrow(/cerrado/);
    expect((await getRegistro(db as never, engineer, id, actor.email)).puedeEditar).toBe(false);
    expect(db.st.eventos.map((e) => e.accion)).toEqual(['registro.creado', 'registro.guardado', 'registro.cerrado']);
    const lista = await listRegistros(db as never, engineer);
    expect(lista[0]).toMatchObject({ estado: 'cerrado', versionNumber: 2, bloqueado: false });
  });

  it('CONTROL: si el formato deja de estar vigente, el borrador se BLOQUEA (no se edita ni se cierra)', async () => {
    const db = fakeDb();
    const { id } = await createRegistro(db as never, engineer, { idFormato: 1, equipo: 'Monitor de signos vitales' }, actor);
    await saveAnotaciones(db as never, engineer, id, [{ id: 'a1', tipo: 'marca', page: 1, x: 10, y: 10 }], actor);
    // Sale la V3 del formato: la V2 queda obsoleta.
    const nueva = fakeDb({ currentVersion: 23 });
    nueva.st.registros = db.st.registros;
    const vig = await vigenciaDe(nueva as never, 10, 22);
    expect(vig).toMatchObject({ vigente: false, idVersionVigente: 23 });
    expect(vig.motivo).toMatch(/ya no está vigente: diligencie la versión vigente/);
    await expect(saveAnotaciones(nueva as never, engineer, id, [], actor)).rejects.toMatchObject({ status: 409 });
    await expect(closeRegistro(nueva as never, engineer, id, actor)).rejects.toMatchObject({ status: 409 });
    expect(await getRegistro(nueva as never, engineer, id, actor.email)).toMatchObject({ bloqueado: true, puedeEditar: false, motivoBloqueo: expect.stringMatching(/no está vigente/) });
    // Formato anulado: tampoco se diligencia uno nuevo.
    const anulado = fakeDb({ docStatus: 'anulado' });
    expect((await vigenciaDe(anulado as never, 10, 22)).motivo).toMatch(/anulado/);
    await expect(createRegistro(anulado as never, engineer, { idFormato: 1, equipo: 'Monitor' }, actor)).rejects.toMatchObject({ status: 409 });
  });

  it('el PDF diligenciado sale de la versión del registro, verificada, con la marca de copia controlada', async () => {
    const db = fakeDb();
    const { id } = await createRegistro(db as never, engineer, { idFormato: 1, equipo: 'Desfibrilador' }, actor);
    await saveAnotaciones(db as never, engineer, id, [{ id: 'a1', tipo: 'texto', page: 1, x: 10, y: 10, texto: 'OK', negrilla: false }], actor);
    const download = vi.fn(async () => pdfVacio());
    const out = await pdfRegistro(db as never, engineer, id, { vacio: false, viewerEmail: 'ingeniero@olp.com', now: new Date('2026-11-06T15:00:00Z') }, { downloadVerifiedPdf: download }, actor);
    expect(download).toHaveBeenCalledWith('od-22', 'a'.repeat(64));
    expect((await PDFDocument.load(out, { updateMetadata: false })).getProducer()).toMatch(/copia controlada/);
    expect(db.st.eventos.at(-1)).toMatchObject({ accion: 'registro.consultado' });
    const n = db.st.eventos.length;
    await pdfRegistro(db as never, engineer, id, { vacio: true, viewerEmail: 'ingeniero@olp.com' }, { downloadVerifiedPdf: download }, actor);
    expect(db.st.eventos.length).toBe(n);
  });
});

describe('Ingeniería biomédica · acceso', () => {
  it('solo ingenieros con el permiso del módulo y Calidad; Calidad además configura', async () => {
    const sgcGrants = [
      { subprocess: { subprocess_url: '/process/sgc-documental' }, companyUser: { company: { id_company: 3, company: 'OLP' } } },
      { subprocess: { subprocess_url: '/process/sgc-documental' }, companyUser: { company: { id_company: 4, company: 'RYAN' } } },
    ];
    const db = {
      subprocessUserCompany: {
        findMany: vi.fn(async ({ where }: { where: { subprocess: { subprocess_url: unknown } } }) =>
          where.subprocess.subprocess_url === BIOMED_SUBPROCESS_URL ? [{ companyUser: { company: { id_company: 3 } } }] : sgcGrants
        ),
      },
      sgcCompanyConfig: { findMany: vi.fn(async () => [{ id_company: 3 }, { id_company: 4 }]) },
    };
    expect(await getBiomedAccessForUser(db as never, 'ing@olp.com')).toEqual([{ idCompany: 3, companyName: 'OLP', canUse: true, canConfigure: false }]);
  });
});

/* SQL: PRUEBAS y PROD repiten TAL CUAL el bloque DDL de la migración, con su guarda antes. */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');

describe('Ingeniería biomédica · SQL', () => {
  const migracion = leer('prisma/migrations/20261106150000_biomedica/migration.sql');
  const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));
  it('PRUEBAS y PROD llevan el bloque idéntico, su guarda antes, y el permiso del módulo', () => {
    const pruebas = leer('prisma/manual/2026-11-06-biomedica-PRUEBAS.sql');
    const prod = leer('prisma/manual/2026-11-06-biomedica-PROD.sql');
    expect(bloque.length).toBeGreaterThan(1500);
    for (const s of [pruebas, prod]) {
      expect(s).toContain(bloque);
      expect(s).toContain("subprocess_url = N'/process/sgc-documental/biomedica'");
    }
    expect(pruebas.indexOf("IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')")).toBeLessThan(pruebas.indexOf('CREATE TABLE'));
    expect(prod.indexOf("IF DB_NAME() <> N'KRONOSDB'")).toBeLessThan(prod.indexOf('CREATE TABLE'));
  });
  it('tablas en dbo (fuera del esquema sgc validado), trazabilidad de solo inserción y reversa con bandera', () => {
    expect(bloque).not.toMatch(/\[sgc\]\./);
    expect(bloque).toContain('biomed_evento_solo_insercion');
    expect(bloque).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|MERGE|DROP)\b/im);
    const reversa = leer('prisma/manual/2026-11-06-biomedica-reversa.sql');
    expect(reversa.indexOf('THROW 51595')).toBeLessThan(reversa.indexOf('DROP TABLE'));
    expect(reversa).toContain("SESSION_CONTEXT(N'biomedica_reversa_acepta_perdida')");
  });
});
