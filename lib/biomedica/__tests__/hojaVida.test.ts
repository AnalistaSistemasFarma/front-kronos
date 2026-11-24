import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { closeRegistro, createRegistro, saveAnotaciones } from '../db';
import { anularMantenimiento, checklistDe, crearMantenimiento, fechaDe, fichaDe, getHojaVida, guardarFicha, hojaVidaHtml, sumarMeses, ACTIVIDAD_INSPECCION } from '../hojaVida';

/**
 * INGENIERÍA BIOMÉDICA · HOJA DE VIDA Y MANTENIMIENTOS (fase 3, 2026-11-23; reunión con Juan Mora):
 * la inspección de un equipo nuevo lo crea en el inventario al cerrarse; cada equipo tiene su hoja de vida
 * (ingreso, vida útil, periodicidad), sus mantenimientos (no se borran ni se cambian: se anulan con motivo),
 * sus formatos diligenciados y su trazabilidad; «Generar reporte» la saca en PDF.
 */

const acceso = { idCompany: 3, companyName: 'OLP', canUse: true, canConfigure: false };
const actor = { email: 'Ingeniero@OLP.com', ip: '10.0.0.1' };
type Row = Record<string, unknown>;

function cumple(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && 'in' in (cond as Row)) return ((cond as { in: unknown[] }).in ?? []).includes(row[k]);
    return cond === null ? row[k] === null || row[k] === undefined : row[k] === cond;
  });
}

function fakeDb(actividad = ACTIVIDAD_INSPECCION) {
  const st = { equipos: [] as Row[], mants: [] as Row[], eventos: [] as Row[], registros: [] as Row[], regEventos: [] as Row[] };
  const formato = { id_biomed_formato: 1, id_company: 3, id_document: 10, actividad, is_active: true };
  const doc = { id_document: 10, code: 'OLP-GCC-04-FR-020', title: 'Inspección de equipos nuevos', status: 'vigente', current_version_id: 22 };
  const nuevoEquipo = (data: Row) => {
    if (st.equipos.some((e) => e.id_company === data.id_company && e.serie === data.serie)) throw Object.assign(new Error('P2002'), { code: 'P2002' });
    const row: Row = { codigo_interno: null, marca: null, modelo: null, clasificacion_riesgo: null, registro_sanitario: null, cliente: null, sede: null, zona: null, ciudad: null, estado: 'bodega', item_code_sap: null, observacion: null, valor_cobro: null, novedad_at: null, fecha_ingreso: null, vida_util_anios: null, periodicidad_mant_meses: null, updated_by: null, updated_at: null, created_at: new Date('2026-11-23T15:00:00Z'), ...data, id_biomed_equipo: st.equipos.length + 1 };
    st.equipos.push(row);
    return row;
  };
  const db = {
    st,
    nuevoEquipo,
    sgcDocument: { findUnique: vi.fn(async () => doc), findMany: vi.fn(async () => [doc]) },
    sgcDocumentVersion: { findUnique: vi.fn(async () => ({ version_number: 2, status: 'vigente' })) },
    biomedFormato: { findFirst: vi.fn(async () => formato) },
    biomedEquipo: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => st.equipos.find((e) => cumple(e, where)) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => nuevoEquipo(data)),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(st.equipos.find((e) => e.id_biomed_equipo === where.id_biomed_equipo)!, data)),
    },
    biomedEquipoEvento: {
      create: vi.fn(async ({ data }: { data: Row }) => st.eventos.push({ ...data, id_biomed_equipo_evento: st.eventos.length + 1, created_at: new Date() })),
      findMany: vi.fn(async ({ where }: { where: Row }) => st.eventos.filter((e) => cumple(e, where)).reverse()),
    },
    biomedMantenimiento: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { estado: 'vigente', anulado_por: null, anulado_at: null, motivo_anulacion: null, numero_reporte: null, observaciones: null, proximo: null, id_biomed_registro: null, created_at: new Date(), ...data, id_biomed_mantenimiento: st.mants.length + 1 };
        st.mants.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Row }) => st.mants.find((m) => cumple(m, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Row }) => st.mants.filter((m) => cumple(m, where))),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(st.mants.find((m) => m.id_biomed_mantenimiento === where.id_biomed_mantenimiento)!, data)),
    },
    biomedRegistro: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id_biomed_registro: st.registros.length + 1, estado: 'borrador', data_json: '[]', created_at: new Date(), closed_at: null, id_biomed_equipo: null, equipo_json: null, ...data };
        st.registros.push(row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const r = st.registros.find((x) => cumple(x, where));
        return r ? { ...r, formato } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: Row }) => st.registros.filter((x) => cumple(x, where)).map((r) => ({ ...r, formato }))),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(st.registros.find((x) => x.id_biomed_registro === where.id_biomed_registro)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = st.registros.filter((x) => cumple(x, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
    },
    biomedEvento: { create: vi.fn(async ({ data }: { data: Row }) => st.regEventos.push(data)) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
}

const anotacion = [{ id: 'a1', kind: 'text', page: 1, x: 10, y: 20, width: 12, height: 1.5, text: 'Cumple', fontFamily: 'helvetica', fontSize: 9, bold: false }];

describe('Biomédica · inspección de equipos nuevos → inventario', () => {
  it('la inspección pide los datos del equipo; al CERRARLA el equipo entra en bodega, con fecha de ingreso, ligado al registro', async () => {
    const db = fakeDb();
    await expect(createRegistro(db as never, acceso, { idFormato: 1, equipoDatos: { modelo: 'X1' } }, actor)).rejects.toThrow('Escriba el equipo');
    await expect(createRegistro(db as never, acceso, { idFormato: 1, equipoDatos: { equipo: 'Bomba de infusión' } }, actor)).rejects.toThrow('serie');
    const { id } = await createRegistro(db as never, acceso, { idFormato: 1, equipoDatos: { equipo: 'Bomba de infusión', modelo: 'X1', serie: 'S-100', cliente: 'Clínica', sede: 'Norte' } }, actor);
    expect(db.st.equipos).toHaveLength(0);
    expect(JSON.parse(String(db.st.registros[0]!.equipo_json))).toMatchObject({ equipo: 'Bomba de infusión', serie: 'S-100', cliente: null, sede: null });
    await saveAnotaciones(db as never, acceso, id, anotacion, actor);
    const r = await closeRegistro(db as never, acceso, id, actor);
    expect(r).toEqual({ closed: true, idEquipo: 1 });
    expect(db.st.equipos[0]).toMatchObject({ serie: 'S-100', estado: 'bodega', cliente: null, created_by: 'ingeniero@olp.com' });
    expect(db.st.equipos[0]!.fecha_ingreso).toBeInstanceOf(Date);
    expect(db.st.registros[0]).toMatchObject({ estado: 'cerrado', id_biomed_equipo: 1 });
    expect(db.st.eventos[0]).toMatchObject({ accion: 'alta', justificacion: 'Inspección de ingreso OLP-GCC-04-FR-020 · registro #1' });
  });

  it('una serie que ya está en el inventario no entra por inspección (ni al crearla ni al cerrarla)', async () => {
    const db = fakeDb();
    db.nuevoEquipo({ id_company: 3, equipo: 'Bomba', serie: 'S-1', created_by: 'x' });
    await expect(createRegistro(db as never, acceso, { idFormato: 1, equipoDatos: { equipo: 'Bomba', serie: 'S-1' } }, actor)).rejects.toMatchObject({ status: 409 });
    const { id } = await createRegistro(db as never, acceso, { idFormato: 1, equipoDatos: { equipo: 'Bomba', serie: 'S-2' } }, actor);
    db.nuevoEquipo({ id_company: 3, equipo: 'Bomba', serie: 'S-2', created_by: 'otro' });
    await saveAnotaciones(db as never, acceso, id, anotacion, actor);
    await expect(closeRegistro(db as never, acceso, id, actor)).rejects.toThrow('ya está en el inventario');
  });

  it('otro formato con el serial de un equipo del inventario queda en su hoja de vida', async () => {
    const db = fakeDb('Mantenimientos (preventivo, correctivo, metrológico)');
    db.nuevoEquipo({ id_company: 3, equipo: 'Bomba', serie: 'S-9', created_by: 'x' });
    await createRegistro(db as never, acceso, { idFormato: 1, equipo: 'Bomba', serial: 'S-9' }, actor);
    await createRegistro(db as never, acceso, { idFormato: 1, equipo: 'Monitor', serial: 'NO-EXISTE' }, actor);
    expect(db.st.registros.map((r) => r.id_biomed_equipo)).toEqual([1, null]);
    await createRegistro(db as never, acceso, { idFormato: 1, idEquipo: 1 }, actor);
    expect(db.st.registros[2]).toMatchObject({ equipo: 'Bomba', serial: 'S-9', id_biomed_equipo: 1 });
  });
});

describe('Biomédica · hoja de vida y mantenimientos', () => {
  it('fechas, meses y lista de chequeo se validan', () => {
    expect(sumarMeses(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(sumarMeses(new Date('2026-11-15T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2027-05-15');
    expect(() => fechaDe('2026-02-30', 'la fecha')).toThrow('fecha inválida');
    expect(fechaDe('', 'la fecha', false)).toBeNull();
    expect(checklistDe([{ item: 'Pantalla', resultado: 'ok' }, { item: '  ', resultado: 'ok' }])).toEqual([{ item: 'Pantalla', resultado: 'ok', nota: null }]);
    expect(() => checklistDe([{ item: 'Pantalla', resultado: 'bien' }])).toThrow('Marque el resultado');
    expect(() => checklistDe([{ item: 'A', resultado: 'ok' }, { item: 'a', resultado: 'na' }])).toThrow('repetido');
  });

  it('la ficha calcula el próximo preventivo (del último preventivo o del ingreso), el vencido y el fin de la vida útil', () => {
    const eq = { fecha_ingreso: new Date('2025-01-10T00:00:00Z'), vida_util_anios: 5, periodicidad_mant_meses: 6 };
    const hoy = new Date('2026-11-23T00:00:00Z');
    expect(fichaDe(eq, [], hoy)).toMatchObject({ proximoMantenimiento: '2025-07-10', vencido: true, finVidaUtil: '2030-01-10', ultimoPreventivo: null });
    const ms = [
      { fecha: '2026-10-01', tipo: 'preventivo' as const, estado: 'vigente' as const, proximo: '2027-04-01' },
      { fecha: '2026-11-01', tipo: 'correctivo' as const, estado: 'vigente' as const, proximo: null },
      { fecha: '2026-11-20', tipo: 'preventivo' as const, estado: 'anulado' as const, proximo: '2027-05-20' },
    ];
    expect(fichaDe(eq, ms, hoy)).toMatchObject({ ultimoPreventivo: '2026-10-01', proximoMantenimiento: '2027-04-01', vencido: false });
    expect(fichaDe({ fecha_ingreso: null, vida_util_anios: null, periodicidad_mant_meses: null }, [], hoy)).toMatchObject({ proximoMantenimiento: null, finVidaUtil: null });
  });

  it('la hoja de vida se llena sin justificación; cambiar algo ya escrito la exige; todo queda en la trazabilidad', async () => {
    const db = fakeDb();
    db.nuevoEquipo({ id_company: 3, equipo: 'Bomba', serie: 'S-1', created_by: 'x' });
    expect(await guardarFicha(db as never, acceso, 1, { fechaIngreso: '2025-01-10', vidaUtilAnios: 5, periodicidadMeses: 6 }, actor)).toEqual({ changed: true });
    expect(await guardarFicha(db as never, acceso, 1, { fechaIngreso: '2025-01-10', vidaUtilAnios: 5, periodicidadMeses: 6 }, actor)).toEqual({ changed: false });
    await expect(guardarFicha(db as never, acceso, 1, { periodicidadMeses: 3 }, actor)).rejects.toThrow('por qué cambia');
    await expect(guardarFicha(db as never, acceso, 1, { periodicidadMeses: 0 }, actor)).rejects.toThrow('entre 1 y 120');
    await expect(guardarFicha(db as never, acceso, 1, { fechaIngreso: '2999-01-01' }, actor)).rejects.toThrow('futura');
    await guardarFicha(db as never, acceso, 1, { periodicidadMeses: 3, justificacion: 'Recomendación del fabricante' }, actor);
    expect(db.st.equipos[0]).toMatchObject({ periodicidad_mant_meses: 3, vida_util_anios: 5 });
    expect(db.st.eventos.map((e) => e.accion)).toEqual(['hoja_vida', 'hoja_vida']);
    expect(JSON.parse(String(db.st.eventos[1]!.antes))).toEqual({ periodicidad_mant_meses: 6 });
  });

  it('un mantenimiento exige fecha (no futura), tipo y responsables; el preventivo calcula el próximo; se anula con motivo y no se borra', async () => {
    const db = fakeDb();
    db.nuevoEquipo({ id_company: 3, equipo: 'Bomba', serie: 'S-1', created_by: 'x', periodicidad_mant_meses: 6 });
    await expect(crearMantenimiento(db as never, acceso, 1, { fecha: '2026-11-01', tipo: 'otro', responsables: 'Byron' }, actor)).rejects.toThrow('tipo de mantenimiento');
    await expect(crearMantenimiento(db as never, acceso, 1, { fecha: '2026-11-01', tipo: 'preventivo' }, actor)).rejects.toThrow('responsables');
    await expect(crearMantenimiento(db as never, acceso, 1, { fecha: '2999-11-01', tipo: 'preventivo', responsables: 'Byron' }, actor)).rejects.toThrow('futura');
    const r = await crearMantenimiento(db as never, acceso, 1, { fecha: '2026-11-01', tipo: 'preventivo', responsables: 'Byron', numeroReporte: 'R-1', checklist: [{ item: 'Pantalla', resultado: 'no_ok', nota: 'rayada' }] }, actor);
    expect(r).toEqual({ id: 1, proximo: '2027-05-01' });
    await crearMantenimiento(db as never, acceso, 1, { fecha: '2026-11-02', tipo: 'correctivo', responsables: 'Byron' }, actor);
    expect(db.st.mants[1]).toMatchObject({ tipo: 'correctivo', proximo: null });
    expect(JSON.parse(String(db.st.eventos[0]!.despues))).toMatchObject({ tipo: 'preventivo', noOk: ['Pantalla'], proximo: '2027-05-01' });
    await expect(anularMantenimiento(db as never, acceso, 1, 1, { motivo: 'x' }, actor)).rejects.toThrow('motivo');
    await anularMantenimiento(db as never, acceso, 1, 1, { motivo: 'Registrado en el equipo equivocado' }, actor);
    expect(db.st.mants[0]).toMatchObject({ estado: 'anulado', anulado_por: 'ingeniero@olp.com' });
    await expect(anularMantenimiento(db as never, acceso, 1, 1, { motivo: 'otra vez' }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(anularMantenimiento(db as never, acceso, 2, 1, { motivo: 'de otro equipo' }, actor)).rejects.toMatchObject({ status: 404 });
  });

  it('la hoja de vida reúne ficha, mantenimientos, formatos e historial; el reporte escapa el texto y lleva el formato vigente', async () => {
    const db = fakeDb();
    db.nuevoEquipo({ id_company: 3, equipo: 'Bomba <b>', serie: 'S-1', created_by: 'x', periodicidad_mant_meses: 6, fecha_ingreso: new Date('2026-01-01T00:00:00Z') });
    await crearMantenimiento(db as never, acceso, 1, { fecha: '2026-11-01', tipo: 'preventivo', responsables: 'Byron', checklist: [{ item: 'Cableado', resultado: 'ok' }] }, actor);
    await createRegistro(db as never, { ...acceso }, { idFormato: 1, equipoDatos: { equipo: 'Otro', serie: 'S-77' } }, actor);
    db.st.registros[0]!.id_biomed_equipo = 1;
    const h = await getHojaVida(db as never, acceso, 1);
    expect(h.ficha).toMatchObject({ fechaIngreso: '2026-01-01', ultimoPreventivo: '2026-11-01', proximoMantenimiento: '2027-05-01' });
    expect(h.mantenimientos).toHaveLength(1);
    expect(h.registros[0]).toMatchObject({ code: 'OLP-GCC-04-FR-020', actividad: ACTIVIDAD_INSPECCION });
    expect(h.historial.map((x) => x.accion)).toContain('mantenimiento');
    const html = hojaVidaHtml(h, { code: 'OLP-GCC-04-FR-030', title: 'Hoja de vida', version: 1 }, { empresa: 'OLP', generadoPor: 'ingeniero@olp.com', generadoAt: new Date('2026-11-23T20:00:00Z') });
    expect(html).toContain('Bomba &lt;b&gt;');
    expect(html).not.toContain('Bomba <b>');
    expect(html).toContain('Formato OLP-GCC-04-FR-030 · V1');
    expect(html).toContain('Cableado: <b>OK</b>');
    expect(hojaVidaHtml(h, null, { empresa: 'OLP', generadoPor: 'x', generadoAt: new Date() })).toContain('Reporte del sistema');
    await expect(getHojaVida(db as never, { ...acceso, canUse: false }, 1)).rejects.toMatchObject({ status: 403 });
    await expect(getHojaVida(db as never, { ...acceso, idCompany: 1 }, 1)).rejects.toMatchObject({ status: 404 });
  });
});

describe('Biomédica · hoja de vida · SQL', () => {
  const root = path.resolve(__dirname, '../../..');
  const leer = (p: string) => readFileSync(path.join(root, p), 'utf8');
  const bloque = (s: string) => s.slice(s.indexOf('SET XACT_ABORT ON;'), s.indexOf('/* BLOQUE-DDL-FIN */'));
  const mig = leer('prisma/migrations/20261123150000_biomedica_hoja_vida/migration.sql');
  const pruebas = leer('prisma/manual/2026-11-23-biomedica-hoja-vida-PRUEBAS.sql');
  const prod = leer('prisma/manual/2026-11-23-biomedica-hoja-vida-PROD.sql');
  const reversa = leer('prisma/manual/2026-11-23-biomedica-hoja-vida-reversa.sql');

  it('PRUEBAS y PROD llevan el bloque idéntico de la migración, con su guarda antes', () => {
    expect(bloque(pruebas)).toBe(bloque(mig));
    expect(bloque(prod)).toBe(bloque(mig));
    expect(pruebas.indexOf("DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')")).toBeLessThan(pruebas.indexOf('SET XACT_ABORT ON;'));
    expect(prod.indexOf("DB_NAME() <> N'KRONOSDB'")).toBeLessThan(prod.indexOf('SET XACT_ABORT ON;'));
  });

  it('solo aditivo en dbo (columnas NULL y tabla nueva), mantenimientos sin borrado ni cambios, y reversa con bandera', () => {
    const b = bloque(mig);
    expect(b).not.toMatch(/\bsgc\./);
    expect(b).not.toMatch(/DROP |DELETE FROM|UPDATE \[dbo\]/);
    expect(b).toMatch(/ADD \[fecha_ingreso\] DATE NULL/);
    expect(b).toMatch(/CHECK \(\[tipo\] IN \(N'preventivo', N'correctivo', N'metrologico'\)\)/);
    expect(b).toContain('biomed_mantenimiento_control');
    expect(b).toContain('no se borra');
    expect(reversa).toContain("SESSION_CONTEXT(N'biomedica_hoja_vida_reversa_acepta_perdida')");
    expect(reversa.indexOf('THROW 51595')).toBeLessThan(reversa.indexOf('DROP TABLE'));
  });
});
