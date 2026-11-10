import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  aplicarCargue,
  asignarArticuloSap,
  cobros,
  crearEquipo,
  editarEquipo,
  esBodega,
  estadoPorUbicacion,
  historialEquipo,
  idsFiltrados,
  listEquipos,
  listValores,
  moverEquipos,
  resumenInventario,
  saveValor,
  simularCargue,
} from '../inventario';
import { leerInventarioXlsx, textoCelda } from '../inventarioExcel';

/**
 * INVENTARIO DE EQUIPOS BIOMÉDICOS (fase 2, 2026-11-10; reunión con Juan Mora y formato
 * OLP-GCC-04-FR-017): seriales que se distribuyen (bloqueados), se devuelven, faltan o se dañan
 * (y se cobran con el valor unitario), artículo de SAP opcional, cargue masivo con simulación y
 * control de cambios con justificación.
 */

const acceso = { idCompany: 3, companyName: 'OLP', canUse: true, canConfigure: false };
const sinAcceso = { ...acceso, canUse: false };
const actor = { email: 'Ingeniero@OLP.com', ip: '10.0.0.1' };
const byron = { email: 'byron@olp.com' };

type Row = Record<string, unknown>;

/** ¿La fila cumple el where de Prisma? (igualdad, in, contains, OR y null). */
function cumple(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((w) => cumple(row, w));
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; contains?: string };
      if (c.in) return c.in.includes(v);
      if (c.contains !== undefined) return String(v ?? '').toLowerCase().includes(c.contains.toLowerCase());
    }
    return cond === null ? v === null || v === undefined : v === cond;
  });
}

function fakeDb() {
  const st = { equipos: [] as Row[], valores: [] as Row[], eventos: [] as Row[] };
  let idEq = 0;
  const nuevoEquipo = (data: Row): Row => {
    if (st.equipos.some((e) => e.id_company === data.id_company && String(e.serie).toLowerCase() === String(data.serie).toLowerCase())) throw Object.assign(new Error('P2002'), { code: 'P2002' });
    const base: Row = { codigo_interno: null, marca: null, modelo: null, clasificacion_riesgo: null, registro_sanitario: null, cliente: null, sede: null, zona: null, ciudad: null, estado: 'bodega', item_code_sap: null, observacion: null, valor_cobro: null, novedad_at: null, updated_by: null, updated_at: null, created_at: new Date('2026-11-10T15:00:00Z') };
    const row = { ...base, ...data, id_biomed_equipo: ++idEq };
    st.equipos.push(row);
    return row;
  };
  const orden = (rows: Row[]) => [...rows].sort((a, b) => String(a.codigo_interno ?? '').localeCompare(String(b.codigo_interno ?? '')) || String(a.serie).localeCompare(String(b.serie)));
  const groupBy = (rows: Row[], by: string[]) => {
    const m = new Map<string, Row & { _count: { _all: number } }>();
    for (const r of rows) {
      const key = JSON.stringify(by.map((b) => r[b] ?? null));
      const g = m.get(key) ?? { ...Object.fromEntries(by.map((b) => [b, r[b] ?? null])), _count: { _all: 0 } };
      g._count._all += 1;
      m.set(key, g);
    }
    return [...m.values()];
  };
  const db = {
    st,
    biomedEquipo: {
      findFirst: async ({ where }: { where: Row }) => st.equipos.find((e) => cumple(e, where)) ?? null,
      findMany: async ({ where, skip = 0, take }: { where?: Row; skip?: number; take?: number }) => {
        const rows = orden(st.equipos.filter((e) => cumple(e, where)));
        return rows.slice(skip, take === undefined ? undefined : skip + take);
      },
      count: async ({ where }: { where: Row }) => st.equipos.filter((e) => cumple(e, where)).length,
      groupBy: async ({ by, where }: { by: string[]; where: Row }) => groupBy(st.equipos.filter((e) => cumple(e, where)), by),
      create: async ({ data }: { data: Row }) => nuevoEquipo(data),
      createMany: async ({ data }: { data: Row[] }) => {
        data.forEach(nuevoEquipo);
        return { count: data.length };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => Object.assign(st.equipos.find((e) => cumple(e, where))!, data),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = st.equipos.filter((e) => cumple(e, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    biomedValorUnitario: {
      findMany: async ({ where }: { where: Row }) => st.valores.filter((v) => cumple(v, where)),
      findFirst: async ({ where }: { where: Row }) => st.valores.find((v) => cumple(v, where)) ?? null,
      upsert: async ({ where, create, update }: { where: { id_company_codigo_interno: Row }; create: Row; update: Row }) => {
        const v = st.valores.find((x) => cumple(x, where.id_company_codigo_interno));
        if (v) return Object.assign(v, update);
        const row = { ...create, updated_at: create.updated_at ?? new Date() };
        st.valores.push(row);
        return row;
      },
    },
    biomedEquipoEvento: {
      createMany: async ({ data }: { data: Row[] }) => {
        data.forEach((d) => st.eventos.push({ ...d, id_biomed_equipo_evento: st.eventos.length + 1, created_at: new Date() }));
        return { count: data.length };
      },
      findMany: async ({ where }: { where: Row }) => st.eventos.filter((e) => cumple(e, where)).reverse(),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

const fila = (serie: string, extra: Record<string, string | null> = {}) => ({
  fila: 6,
  datos: { codigo_interno: '4053677', equipo: 'BOMBA DE INFUSION', marca: 'MINDRAY', modelo: 'BENEFUSION VP5', serie, clasificacion_riesgo: 'IIB', registro_sanitario: null, cliente: 'PISA FARMACEUTICA DE COLOMBIA SA', sede: 'Bodega', zona: null, ciudad: 'Bogotá', ...extra },
});

async function cargado(n = 5) {
  const db = fakeDb();
  const filas = Array.from({ length: n }, (_, i) => fila(`SK0070646${i}`));
  await aplicarCargue(db as never, acceso, filas, [], { nombreArchivo: 'FR-017.xlsx' }, actor);
  return db;
}
const ids = (db: ReturnType<typeof fakeDb>, ...series: string[]) => db.st.equipos.filter((e) => series.includes(String(e.serie))).map((e) => e.id_biomed_equipo as number);

describe('Inventario biomédico · cargue masivo con simulación', () => {
  it('la simulación no escribe; aplicar crea con su estado por ubicación y deja el historial', async () => {
    const db = fakeDb();
    const filas = [fila('A1'), fila('A2', { cliente: 'SANSMED', sede: 'Sansmed / Fundación Universitaria Juan N Corpas', ciudad: 'Bogotá' })];
    const sim = await simularCargue(db as never, acceso, filas, [{ fila: 9, serie: null, motivo: 'Sin serie.' }]);
    expect(sim).toMatchObject({ leidas: 3, iguales: 0, noEnArchivo: 0 });
    expect(sim.nuevos).toHaveLength(2);
    expect(db.st.equipos).toHaveLength(0);
    await expect(aplicarCargue(db as never, acceso, filas, [{ fila: 9, serie: null, motivo: 'Sin serie.' }], {}, actor)).rejects.toThrow(/con error/);
    expect(await aplicarCargue(db as never, acceso, filas, [], { nombreArchivo: 'FR-017.xlsx' }, actor)).toMatchObject({ creados: 2, actualizados: 0 });
    expect(db.st.equipos.map((e) => [e.serie, e.estado, e.created_by])).toEqual([
      ['A1', 'bodega', 'ingeniero@olp.com'],
      ['A2', 'distribuido', 'ingeniero@olp.com'],
    ]);
    expect(db.st.eventos.map((e) => e.accion)).toEqual(['carga', 'carga']);
    expect(JSON.parse(String(db.st.eventos[0]!.despues))).toMatchObject({ archivo: 'FR-017.xlsx' });
  });

  it('un archivo que cambia equipos existentes exige justificación; un faltante no lo cambia un archivo', async () => {
    const db = await cargado(3);
    const f = [fila('SK00706460'), fila('SK00706461', { modelo: 'BENEFUSION EVP', cliente: 'HOSPITALARTE', sede: 'Hospitalarte / Clinica Central del Eje', ciudad: 'Pereira' }), fila('SK00706462', { cliente: 'HOSPITALARTE', sede: 'Hospitalarte', ciudad: 'Pereira' })];
    await moverEquipos(db as never, acceso, { accion: 'faltante', ids: ids(db, 'SK00706462'), observacion: 'No llegó en la devolución' }, actor);
    const sim = await simularCargue(db as never, acceso, f, []);
    expect(sim.iguales).toBe(1);
    expect(sim.cambios.find((c) => c.serie === 'SK00706461')).toMatchObject({ estado: { antes: 'bodega', despues: 'distribuido' } });
    expect(sim.cambios.find((c) => c.serie === 'SK00706462')!.estado).toBeNull();
    await expect(aplicarCargue(db as never, acceso, f, [], {}, actor)).rejects.toThrow(/por qué se actualiza/);
    expect(await aplicarCargue(db as never, acceso, f, [], { justificacion: 'Inventario de octubre de Juan' }, actor)).toMatchObject({ creados: 0, actualizados: 2 });
    expect(db.st.equipos.find((e) => e.serie === 'SK00706461')).toMatchObject({ estado: 'distribuido', modelo: 'BENEFUSION EVP', ciudad: 'Pereira' });
    expect(db.st.equipos.find((e) => e.serie === 'SK00706462')).toMatchObject({ estado: 'faltante' });
    expect(db.st.eventos.filter((e) => e.accion === 'carga_cambio').map((e) => e.justificacion)).toEqual(['Inventario de octubre de Juan', 'Inventario de octubre de Juan']);
    // Sin nada nuevo: no escribe.
    expect(await aplicarCargue(db as never, acceso, f, [], { justificacion: 'otra vez igual' }, actor)).toMatchObject({ creados: 0, actualizados: 0, lote: null });
    // Lo que está en el inventario y no en el archivo se informa (no se borra).
    expect((await simularCargue(db as never, acceso, [fila('SK00706460')], [])).noEnArchivo).toBe(2);
  });
});

describe('Inventario biomédico · distribuir, devolver, faltante, dañado y reintegrar', () => {
  it('distribuir bloquea el serial; solo se devuelve lo distribuido; todo queda en el historial', async () => {
    const db = await cargado(5);
    const tres = ids(db, 'SK00706460', 'SK00706461', 'SK00706462');
    await expect(moverEquipos(db as never, acceso, { accion: 'distribuir', ids: tres, cliente: 'SANSMED' }, actor)).rejects.toThrow(/cliente, sede y ciudad/);
    await expect(moverEquipos(db as never, acceso, { accion: 'distribuir', ids: tres, cliente: 'SANSMED', sede: 'bodega', ciudad: 'Bogotá' }, actor)).rejects.toThrow(/no puede ser la bodega/);
    expect(await moverEquipos(db as never, acceso, { accion: 'distribuir', ids: tres, cliente: 'SANSMED', sede: 'Sansmed / Juan N Corpas', ciudad: 'Bogotá' }, byron)).toMatchObject({ movidos: 3 });
    // Ya distribuidos: no se pueden volver a tomar para otro contrato.
    await expect(moverEquipos(db as never, acceso, { accion: 'distribuir', ids: tres.slice(0, 1), cliente: 'OTRO', sede: 'Otra', ciudad: 'Cali' }, actor)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/SK00706460 \(Distribuido\)/) });
    await expect(moverEquipos(db as never, acceso, { accion: 'devolver', ids: ids(db, 'SK00706463'), sede: 'Bodega' }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(moverEquipos(db as never, acceso, { accion: 'devolver', ids: tres, sede: 'Hospital' }, actor)).rejects.toThrow(/Bodega/);
    expect(await moverEquipos(db as never, acceso, { accion: 'devolver', ids: tres.slice(0, 2), cliente: 'PISA', ciudad: 'Bogotá' }, actor)).toMatchObject({ movidos: 2 });
    expect(db.st.equipos.filter((e) => tres.includes(e.id_biomed_equipo as number)).map((e) => [e.estado, e.sede])).toEqual([
      ['bodega', 'Bodega'],
      ['bodega', 'Bodega'],
      ['distribuido', 'Sansmed / Juan N Corpas'],
    ]);
    const h = await historialEquipo(db as never, acceso, tres[0]!);
    expect(h.historial.map((x) => x.accion)).toEqual(['devolver', 'distribuir', 'carga']);
    expect(h.historial[1]).toMatchObject({ actor: 'byron@olp.com', antes: { estado: 'bodega' }, despues: { estado: 'distribuido', cliente: 'SANSMED' } });
    await expect(moverEquipos(db as never, acceso, { accion: 'otra', ids: tres }, actor)).rejects.toThrow(/Acción inválida/);
    await expect(moverEquipos(db as never, acceso, { accion: 'devolver', ids: [] }, actor)).rejects.toThrow(/al menos un equipo/);
    await expect(moverEquipos(db as never, acceso, { accion: 'devolver', ids: [99999] }, actor)).rejects.toThrow(/recargue/);
  });

  it('faltante o dañado se cobra con el valor unitario (congelado); sin valor lo toma al asignarlo; reintegrar quita el cobro', async () => {
    const db = await cargado(4);
    const [a, b, c, d] = ids(db, 'SK00706460', 'SK00706461', 'SK00706462', 'SK00706463');
    await moverEquipos(db as never, acceso, { accion: 'distribuir', ids: [a, b, c, d], cliente: 'HOSPITALARTE', sede: 'Clinica Central del Eje', ciudad: 'Pereira' }, actor);
    await expect(moverEquipos(db as never, acceso, { accion: 'faltante', ids: [a] }, actor)).rejects.toThrow(/observación/);
    // Sin valor unitario aún: queda pendiente.
    await moverEquipos(db as never, acceso, { accion: 'faltante', ids: [a], observacion: 'No llegó en la devolución' }, actor);
    expect(db.st.equipos.find((e) => e.id_biomed_equipo === a)).toMatchObject({ estado: 'faltante', valor_cobro: null, cliente: 'HOSPITALARTE' });
    expect((await cobros(db as never, acceso)).sinValor).toBe(1);
    expect(await saveValor(db as never, acceso, { codigo: '4053677', valor: 4250000.555 }, actor)).toEqual({ codigo: '4053677', valor: 4250000.56, cobrosCompletados: 1 });
    await moverEquipos(db as never, acceso, { accion: 'danado', ids: [b], observacion: 'Pantalla rota' }, actor);
    // Cambia el valor: lo ya marcado conserva el suyo.
    await saveValor(db as never, acceso, { codigo: '4053677', valor: 5000000 }, actor);
    await moverEquipos(db as never, acceso, { accion: 'danado', ids: [c], observacion: 'No enciende' }, actor);
    const cb = await cobros(db as never, acceso);
    expect(cb.clientes).toEqual([{ cliente: 'HOSPITALARTE', faltantes: 1, danados: 2, total: 13500001.12, sinValor: 0 }]);
    expect(cb.total).toBe(13500001.12);
    await expect(moverEquipos(db as never, acceso, { accion: 'reintegrar', ids: [b], observacion: '' }, actor)).rejects.toThrow(/por qué vuelve/);
    await moverEquipos(db as never, acceso, { accion: 'reintegrar', ids: [b], observacion: 'Reparada por el proveedor' }, actor);
    expect(db.st.equipos.find((e) => e.id_biomed_equipo === b)).toMatchObject({ estado: 'bodega', valor_cobro: null, sede: 'Bodega' });
    expect((await cobros(db as never, acceso)).total).toBe(9250000.56);
    await expect(saveValor(db as never, acceso, { codigo: '4053677', valor: -1 }, actor)).rejects.toThrow(/mayor o igual a cero/);
    await expect(saveValor(db as never, acceso, { codigo: '', valor: 1 }, actor)).rejects.toThrow(/código interno/);
    const valores = await listValores(db as never, acceso);
    expect(valores).toEqual([expect.objectContaining({ codigo: '4053677', equipos: 4, valor: 5000000, descripciones: ['BOMBA DE INFUSION · BENEFUSION VP5'] })]);
  });
});

describe('Inventario biomédico · alta, edición (control de cambios), artículo SAP y consulta', () => {
  it('alta con serie única; editar exige justificación y cambiar la serie es «cambio de serial»', async () => {
    const db = await cargado(2);
    await expect(crearEquipo(db as never, acceso, { equipo: 'BOMBA' }, actor)).rejects.toThrow(/serie/);
    await expect(crearEquipo(db as never, acceso, { serie: 'X' }, actor)).rejects.toThrow(/equipo/);
    await expect(crearEquipo(db as never, acceso, { equipo: 'BOMBA', serie: 'sk00706460' }, actor)).rejects.toMatchObject({ status: 409 });
    const { id } = await crearEquipo(db as never, acceso, { equipo: 'CENTRAL DE MONITOREO', serie: 'CM-1', cliente: 'Clinica Casanare', sede: 'Clinica Casanare', ciudad: 'Yopal' }, actor);
    expect(db.st.equipos.find((e) => e.id_biomed_equipo === id)).toMatchObject({ estado: 'distribuido' });
    expect(await editarEquipo(db as never, acceso, id, { serie: 'CM-1' }, actor)).toEqual({ changed: false });
    await expect(editarEquipo(db as never, acceso, id, { serie: 'CM-2' }, actor)).rejects.toThrow(/por qué se cambia/);
    await expect(editarEquipo(db as never, acceso, id, { serie: 'SK00706460', justificacion: 'Error de digitación' }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(editarEquipo(db as never, acceso, id, { equipo: '', justificacion: 'Error de digitación' }, actor)).rejects.toThrow(/no puede quedar vacío/);
    expect(await editarEquipo(db as never, acceso, id, { serie: 'CM-2', modelo: 'BeneVision', justificacion: 'Error de digitación en la serie' }, actor)).toEqual({ changed: true });
    const ev = db.st.eventos.at(-1)!;
    expect(ev).toMatchObject({ accion: 'cambio_serial', justificacion: 'Error de digitación en la serie' });
    expect(JSON.parse(String(ev.antes))).toEqual({ serie: 'CM-1', modelo: null });
    await expect(editarEquipo(db as never, acceso, 99999, { serie: 'Z', justificacion: 'xxxxxx' }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(editarEquipo(db as never, acceso, id, { modelo: 'x'.repeat(151), justificacion: 'largo' }, actor)).rejects.toThrow(/máximo 150/);
  });

  it('artículo de SAP opcional en bloque (y se quita); lista paginada, filtros, ids filtrados y resumen', async () => {
    const db = await cargado(5);
    const dos = ids(db, 'SK00706460', 'SK00706461');
    expect(await asignarArticuloSap(db as never, acceso, { ids: dos, itemCode: 'PT-BOMBA-VP5', itemName: 'Bomba VP5' }, actor)).toEqual({ asignados: 2 });
    expect(db.st.equipos.filter((e) => e.item_code_sap === 'PT-BOMBA-VP5')).toHaveLength(2);
    await asignarArticuloSap(db as never, acceso, { ids: dos.slice(0, 1), itemCode: null }, actor);
    expect(db.st.equipos.filter((e) => e.item_code_sap === 'PT-BOMBA-VP5')).toHaveLength(1);
    await moverEquipos(db as never, acceso, { accion: 'distribuir', ids: dos, cliente: 'SANSMED', sede: 'Sansmed', ciudad: 'Bogotá' }, actor);
    const l = await listEquipos(db as never, acceso, { estado: 'distribuido', page: 1, pageSize: 10 });
    expect(l).toMatchObject({ total: 2, page: 1, pageSize: 10 });
    expect(l.equipos.map((e) => e.serie)).toEqual(['SK00706460', 'SK00706461']);
    expect((await listEquipos(db as never, acceso, { q: '0646' })).total).toBe(5);
    expect((await listEquipos(db as never, acceso, { cliente: 'SANSMED', estado: 'nada' })).total).toBe(2);
    expect(await idsFiltrados(db as never, acceso, { estado: 'bodega' })).toHaveLength(3);
    const r = await resumenInventario(db as never, acceso);
    expect(r).toMatchObject({ total: 5, porEstado: { bodega: 3, distribuido: 2, faltante: 0, danado: 0 }, bodega: { cliente: 'PISA FARMACEUTICA DE COLOMBIA SA', ciudad: 'Bogotá' } });
    expect(r.clientes).toEqual(['PISA FARMACEUTICA DE COLOMBIA SA', 'SANSMED']);
    await expect(historialEquipo(db as never, acceso, 99999)).rejects.toMatchObject({ status: 404 });
  });

  it('sin el permiso del módulo no se consulta ni se cambia nada', async () => {
    const db = await cargado(1);
    await expect(listEquipos(db as never, sinAcceso, {})).rejects.toMatchObject({ status: 403 });
    await expect(moverEquipos(db as never, sinAcceso, { accion: 'devolver', ids: [1] }, actor)).rejects.toMatchObject({ status: 403 });
    await expect(cobros(db as never, sinAcceso)).rejects.toMatchObject({ status: 403 });
    expect(esBodega(' BODEGA ')).toBe(true);
    expect(estadoPorUbicacion({ sede: null, cliente: 'X' })).toBe('bodega');
  });
});

describe('Inventario biomédico · lectura del Excel (formato FR-017)', () => {
  async function excel(filas: unknown[][]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('DTC-F12-PR09');
    ws.addRow(['', '', 'INVENTARIO DE EQUIPOS BIOMEDICOS', '', '', '', 'CÓDIGO: OLP-GCC-04-FR-017']);
    ws.addRow(['CODIGO INTERNO', 'EQUIPO', 'MARCA', 'MODELO', 'SERIE', 'CLASIFICACION DE RIESGO', 'REGISTRO SANITARIO', 'CLIENTE', 'SEDE', 'ZONA', 'CIUDAD']);
    filas.forEach((f) => ws.addRow(f));
    ws.addRow(['ELABORÓ: INGENIERO BIOMÉDICO', '', '', 'REVISÓ: INGENIERO BIOMÉDICO']);
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }

  it('toma los encabezados, omite el pie del formato y marca sin serie, sin equipo y series repetidas', async () => {
    const out = await leerInventarioXlsx(
      await excel([
        [4053677, 'BOMBA DE INFUSION', 'MINDRAY', 'BENEFUSION VP5', 'SK00706467', 'IIB', null, 'PISA FARMACEUTICA DE COLOMBIA SA', 'Bodega', null, 'Bogotá'],
        ['4058333', { richText: [{ text: 'BOMBA ' }, { text: 'DE INFUSION' }] }, 'MINDRAY', 'BENEFUSION EVP', 'SH2-1', 'IIB', null, 'SANSMED', 'Sansmed', null, 'Bogotá'],
        ['4058333', 'BOMBA', 'MINDRAY', 'X', null, 'IIB'],
        ['4058333', null, 'MINDRAY', 'X', 'SIN-EQUIPO'],
        ['4058333', 'BOMBA', 'MINDRAY', 'X', 'sk00706467'],
        [],
      ])
    );
    expect(out.hoja).toBe('DTC-F12-PR09');
    expect(out.filas.map((f) => [f.fila, f.datos.codigo_interno, f.datos.equipo, f.datos.serie, f.datos.zona])).toEqual([
      [3, '4053677', 'BOMBA DE INFUSION', 'SK00706467', null],
      [4, '4058333', 'BOMBA DE INFUSION', 'SH2-1', null],
    ]);
    expect(out.errores.map((e) => e.motivo)).toEqual(['Sin serie.', 'Sin equipo.', 'Serie repetida (también en la fila 3).']);
  });

  it('rechaza lo que no es un Excel o no tiene los encabezados', async () => {
    await expect(leerInventarioXlsx(new Uint8Array())).rejects.toThrow(/vacío/);
    await expect(leerInventarioXlsx(new TextEncoder().encode('serie,equipo'))).rejects.toThrow(/\.xlsx/);
    await expect(leerInventarioXlsx(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]))).rejects.toThrow(/No se pudo leer/);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['A', 'B']);
    await expect(leerInventarioXlsx(new Uint8Array(await wb.xlsx.writeBuffer()))).rejects.toThrow(/encabezados/);
    expect(textoCelda({ formula: 'A1', result: 7 } as never)).toBe('7');
    expect(textoCelda(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-01');
    expect(textoCelda({ text: 'enlace', hyperlink: 'x' } as never)).toBe('enlace');
  });
});

describe('Inventario biomédico · SQL', () => {
  const dir = path.join(__dirname, '../../../prisma');
  const mig = readFileSync(path.join(dir, 'migrations/20261110150000_biomedica_inventario/migration.sql'), 'utf8');
  const bloque = (s: string) => s.slice(s.indexOf('SET XACT_ABORT ON;'), s.indexOf('/* BLOQUE-DDL-FIN */'));

  it('PRUEBAS y PROD llevan el bloque idéntico de la migración, con su guarda antes', () => {
    for (const [env, guarda] of [
      ['PRUEBAS', "IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')"],
      ['PROD', "IF DB_NAME() <> N'KRONOSDB'"],
    ] as const) {
      const s = readFileSync(path.join(dir, `manual/2026-11-10-biomedica-inventario-${env}.sql`), 'utf8');
      expect(bloque(s)).toBe(bloque(mig));
      expect(s.indexOf(guarda)).toBeGreaterThan(-1);
      expect(s.indexOf(guarda)).toBeLessThan(s.indexOf('CREATE TABLE'));
    }
  });

  it('tablas en dbo, serie única por empresa, estados y valores con CHECK, historial de solo inserción y reversa con bandera', () => {
    expect(mig).not.toMatch(/\[sgc\]\./);
    expect(mig).toMatch(/UNIQUE NONCLUSTERED \(\[id_company\], \[serie\]\)/);
    expect(mig).toMatch(/CHECK \(\[estado\] IN \(N'bodega', N'distribuido', N'faltante', N'danado'\)\)/);
    expect(mig).toMatch(/biomed_equipo_evento_solo_insercion\] ON \[dbo\]\.\[biomed_equipo_evento\] AFTER UPDATE, DELETE/);
    const rev = readFileSync(path.join(dir, 'manual/2026-11-10-biomedica-inventario-reversa.sql'), 'utf8');
    expect(rev).toMatch(/biomedica_inventario_reversa_acepta_perdida/);
    expect(rev.indexOf('THROW 51585')).toBeLessThan(rev.indexOf('DROP TABLE'));
  });
});
