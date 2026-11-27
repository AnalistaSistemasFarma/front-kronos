import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { guardarRepuesto, listRepuestos, moverRepuesto, movimientosRepuesto } from '../repuestos';
import { cronogramaMantenimiento } from '../hojaVida';

/** Repuestos e insumos y cronograma de mantenimiento (Ingeniería biomédica, 2026-11-26). */
const acceso = { idCompany: 3, companyName: 'OLP', canUse: true, canConfigure: false };
const actor = { email: 'Ingeniero@OLP.com' };
type Row = Record<string, unknown>;

function fakeDb() {
  const st = { reps: [] as Row[], movs: [] as Row[], equipos: [{ id_biomed_equipo: 7, id_company: 3, serie: 'S-7', equipo: 'Bomba' }] as Row[], mants: [] as Row[] };
  const db = {
    st,
    biomedRepuesto: {
      findMany: vi.fn(async () => st.reps),
      findFirst: vi.fn(async ({ where }: { where: Row }) => st.reps.find((r) => r.id_biomed_repuesto === where.id_biomed_repuesto && r.id_company === where.id_company) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const r = { id_biomed_repuesto: st.reps.length + 1, unidad: 'unidad', stock: 0, stock_minimo: null, codigo: null, modelo_compatible: null, ubicacion: null, item_code_sap: null, activo: true, ...data };
        st.reps.push(r);
        return r;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(st.reps.find((r) => r.id_biomed_repuesto === where.id_biomed_repuesto)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const r = st.reps.find((x) => x.id_biomed_repuesto === where.id_biomed_repuesto && Number(x.stock) === Number(where.stock));
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
    biomedRepuestoMov: {
      create: vi.fn(async ({ data }: { data: Row }) => st.movs.push({ id_biomed_repuesto_mov: st.movs.length + 1, created_at: new Date(), ...data })),
      findMany: vi.fn(async () => [...st.movs].reverse()),
    },
    biomedEquipo: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => st.equipos.find((e) => e.id_biomed_equipo === where.id_biomed_equipo && e.id_company === where.id_company) ?? null),
      findMany: vi.fn(async ({ where }: { where: Row }) => (where.periodicidad_mant_meses ? st.equipos.filter((e) => e.periodicidad_mant_meses) : st.equipos)),
    },
    biomedMantenimiento: { findMany: vi.fn(async () => st.mants) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
}

describe('Biomédica · repuestos e insumos', () => {
  it('alta con existencia inicial (queda como entrada); la existencia no se edita por los datos', async () => {
    const db = fakeDb();
    await expect(guardarRepuesto(db as never, acceso, { tipo: 'otro', nombre: 'X' }, actor)).rejects.toThrow('repuesto o insumo');
    const { id } = await guardarRepuesto(db as never, acceso, { tipo: 'repuesto', nombre: 'Batería BeneFusion', stockInicial: 5, stockMinimo: 2 }, actor);
    expect(db.st.reps[0]).toMatchObject({ stock: 5, created_by: 'ingeniero@olp.com' });
    expect(db.st.movs[0]).toMatchObject({ tipo: 'entrada', cantidad: 5, stock_resultante: 5 });
    await guardarRepuesto(db as never, acceso, { id, tipo: 'repuesto', nombre: 'Batería BeneFusion VP5', stock: 999 }, actor);
    expect(db.st.reps[0]).toMatchObject({ nombre: 'Batería BeneFusion VP5', stock: 5 });
    expect((await listRepuestos(db as never, acceso))[0]).toMatchObject({ stock: 5, bajoMinimo: false });
  });

  it('salida ligada al equipo, sin existencia negativa; ajuste exige motivo; todo queda en el historial', async () => {
    const db = fakeDb();
    await guardarRepuesto(db as never, acceso, { tipo: 'insumo', nombre: 'Alcohol isopropílico', stockInicial: 3, stockMinimo: 2 }, actor);
    await expect(moverRepuesto(db as never, acceso, 1, { tipo: 'salida', cantidad: 4 }, actor)).rejects.toMatchObject({ status: 409 });
    expect(await moverRepuesto(db as never, acceso, 1, { tipo: 'salida', cantidad: 2, idEquipo: 7, referencia: 'MANT-1' }, actor)).toEqual({ stock: 1 });
    await expect(moverRepuesto(db as never, acceso, 1, { tipo: 'salida', cantidad: 1, idEquipo: 99 }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(moverRepuesto(db as never, acceso, 1, { tipo: 'ajuste', cantidad: 4 }, actor)).rejects.toThrow('motivo');
    expect(await moverRepuesto(db as never, acceso, 1, { tipo: 'ajuste', cantidad: 4, observacion: 'Conteo físico de bodega' }, actor)).toEqual({ stock: 4 });
    expect(db.st.movs.map((m) => [m.tipo, m.cantidad, m.stock_resultante, m.id_biomed_equipo ?? null])).toEqual([
      ['entrada', 3, 3, null],
      ['salida', 2, 1, 7],
      ['ajuste', 3, 4, null],
    ]);
    const h = await movimientosRepuesto(db as never, acceso, 1);
    expect(h.movimientos.find((m) => m.tipo === 'salida')).toMatchObject({ equipo: 'Bomba · S-7', referencia: 'MANT-1' });
    await expect(listRepuestos(db as never, { ...acceso, canUse: false })).rejects.toMatchObject({ status: 403 });
  });

  it('cronograma: próximo preventivo por equipo con periodicidad, vencidos primero', async () => {
    const db = fakeDb();
    db.st.equipos = [
      { id_biomed_equipo: 1, serie: 'A', equipo: 'Bomba', modelo: null, cliente: null, estado: 'bodega', fecha_ingreso: new Date('2020-01-10T00:00:00Z'), vida_util_anios: null, periodicidad_mant_meses: 6 },
      { id_biomed_equipo: 2, serie: 'B', equipo: 'Monitor', modelo: null, cliente: 'Clínica', estado: 'distribuido', fecha_ingreso: null, vida_util_anios: null, periodicidad_mant_meses: 12 },
    ];
    db.st.mants = [{ id_biomed_equipo: 2, fecha: new Date('2026-10-01T00:00:00Z'), proximo: new Date('2027-10-01T00:00:00Z') }];
    const items = await cronogramaMantenimiento(db as never, acceso);
    expect(items.map((i) => [i.serie, i.proximo, i.vencido])).toEqual([
      ['A', '2020-07-10', true],
      ['B', '2027-10-01', false],
    ]);
    expect((await cronogramaMantenimiento(db as never, acceso, 2028)).map((i) => i.serie)).toEqual(['A']);
  });
});

describe('Biomédica · repuestos · SQL', () => {
  const root = path.resolve(__dirname, '../../..');
  const leer = (p: string) => readFileSync(path.join(root, p), 'utf8');
  const bloque = (s: string) => s.slice(s.indexOf('SET XACT_ABORT ON;'), s.indexOf('/* BLOQUE-DDL-FIN */'));
  it('PRUEBAS y PROD llevan el bloque de la migración, con su guarda; movimientos solo inserción; reversa con bandera', () => {
    const mig = leer('prisma/migrations/20261126190000_biomedica_repuestos/migration.sql');
    const pr = leer('prisma/manual/2026-11-26-biomedica-repuestos-PRUEBAS.sql');
    const pd = leer('prisma/manual/2026-11-26-biomedica-repuestos-PROD.sql');
    const rv = leer('prisma/manual/2026-11-26-biomedica-repuestos-reversa.sql');
    expect(bloque(pr)).toBe(bloque(mig));
    expect(bloque(pd)).toBe(bloque(mig));
    expect(pd.indexOf("DB_NAME() <> N'KRONOSDB'")).toBeLessThan(pd.indexOf('SET XACT_ABORT ON;'));
    expect(bloque(mig)).toContain('biomed_repuesto_mov_solo_insercion');
    expect(bloque(mig)).not.toMatch(/\bsgc\./);
    expect(rv).toContain("SESSION_CONTEXT(N'biomedica_repuestos_reversa_acepta_perdida')");
  });
});
