import { SgcError } from '../sgc/errors';
import type { BiomedAccess } from './access';
import type { BiomedDb, InvActor } from './inventario';

/**
 * INGENIERÍA BIOMÉDICA · REPUESTOS E INSUMOS (2026-11-26; reunión de Nicolás Rivera con Juan Mora del 2026-11-23:
 * «tenemos un inventario de repuestos e insumos en un Excel; mejor separado de los equipos y dispositivos»). Mientras no
 * se pueda llevar en SAP, SynerLink conoce las existencias: entradas, salidas (ligadas al equipo donde se usó, para la
 * trazabilidad) y ajustes con motivo. Los movimientos no se borran ni se cambian.
 */

export const TIPOS_REPUESTO = ['repuesto', 'insumo'] as const;
export type TipoRepuesto = (typeof TIPOS_REPUESTO)[number];
export const TIPOS_MOV = ['entrada', 'salida', 'ajuste'] as const;
export type TipoMov = (typeof TIPOS_MOV)[number];

export interface RepuestoDto {
  id: number;
  tipo: TipoRepuesto;
  codigo: string | null;
  nombre: string;
  unidad: string;
  modeloCompatible: string | null;
  ubicacion: string | null;
  stock: number;
  stockMinimo: number | null;
  bajoMinimo: boolean;
  itemCodeSap: string | null;
  activo: boolean;
}

const lower = (s: string) => s.trim().toLowerCase();
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown, campo: string, max: number, obligatorio = false): string | null => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!s) {
    if (obligatorio) throw new SgcError(`Escriba ${campo}.`, 400);
    return null;
  }
  if (s.length > max) throw new SgcError(`${campo[0]!.toUpperCase()}${campo.slice(1)}: máximo ${max} caracteres.`, 400);
  return s;
};
const cantidadDe = (v: unknown, campo = 'la cantidad', permitirCero = false): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (!permitirCero && n === 0) || Math.round(n * 100) !== n * 100) throw new SgcError(`Escriba ${campo} (mayor que cero, hasta 2 decimales).`, 400);
  return n;
};

function puedeUsar(access: BiomedAccess) {
  if (!access.canUse) throw new SgcError('Sin acceso a Ingeniería biomédica.', 403);
}

type Fila = Awaited<ReturnType<BiomedDb['biomedRepuesto']['findFirst']>> & {};
export function repuestoDto(r: NonNullable<Fila>): RepuestoDto {
  const stock = Number(r.stock);
  const min = num(r.stock_minimo);
  return {
    id: r.id_biomed_repuesto,
    tipo: r.tipo as TipoRepuesto,
    codigo: r.codigo,
    nombre: r.nombre,
    unidad: r.unidad,
    modeloCompatible: r.modelo_compatible,
    ubicacion: r.ubicacion,
    stock,
    stockMinimo: min,
    bajoMinimo: min !== null && stock <= min,
    itemCodeSap: r.item_code_sap,
    activo: r.activo,
  };
}

export async function listRepuestos(db: BiomedDb, access: BiomedAccess, f: { tipo?: string | null; q?: string | null } = {}): Promise<RepuestoDto[]> {
  puedeUsar(access);
  const q = (f.q ?? '').trim().slice(0, 100);
  const rows = await db.biomedRepuesto.findMany({
    where: {
      id_company: access.idCompany,
      ...(f.tipo && (TIPOS_REPUESTO as readonly string[]).includes(f.tipo) ? { tipo: f.tipo } : {}),
      ...(q ? { OR: [{ nombre: { contains: q } }, { codigo: { contains: q } }, { modelo_compatible: { contains: q } }] } : {}),
    },
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    take: 2000,
  });
  return rows.map(repuestoDto);
}

/** Alta o edición de los datos de un repuesto (no de su existencia: esa cambia solo con movimientos). */
export async function guardarRepuesto(db: BiomedDb, access: BiomedAccess, input: Record<string, unknown>, actor: InvActor) {
  puedeUsar(access);
  const tipo = String(input.tipo ?? '') as TipoRepuesto;
  if (!TIPOS_REPUESTO.includes(tipo)) throw new SgcError('Elija si es repuesto o insumo.', 400);
  const data = {
    tipo,
    codigo: texto(input.codigo, 'el código', 50),
    nombre: texto(input.nombre, 'el nombre', 200, true)!,
    unidad: texto(input.unidad, 'la unidad', 30) ?? 'unidad',
    modelo_compatible: texto(input.modeloCompatible, 'el modelo compatible', 150),
    ubicacion: texto(input.ubicacion, 'la ubicación', 100),
    stock_minimo: input.stockMinimo === null || input.stockMinimo === undefined || input.stockMinimo === '' ? null : cantidadDe(input.stockMinimo, 'el mínimo', true),
    item_code_sap: texto(input.itemCodeSap, 'el artículo de SAP', 50),
    activo: input.activo !== false,
  };
  const email = lower(actor.email);
  const id = input.id === undefined || input.id === null ? null : Number(input.id);
  if (id) {
    const prev = await db.biomedRepuesto.findFirst({ where: { id_biomed_repuesto: id, id_company: access.idCompany } });
    if (!prev) throw new SgcError('Repuesto no encontrado.', 404);
    await db.biomedRepuesto.update({ where: { id_biomed_repuesto: id }, data: { ...data, updated_by: email, updated_at: new Date() } });
    return { id };
  }
  const inicial = input.stockInicial === undefined || input.stockInicial === null || input.stockInicial === '' ? 0 : cantidadDe(input.stockInicial, 'la existencia inicial', true);
  const r = await db.$transaction(async (tx) => {
    const row = await tx.biomedRepuesto.create({ data: { id_company: access.idCompany, ...data, stock: inicial, created_by: email } });
    if (inicial > 0) {
      await tx.biomedRepuestoMov.create({
        data: { id_company: access.idCompany, id_biomed_repuesto: row.id_biomed_repuesto, tipo: 'entrada', cantidad: inicial, stock_resultante: inicial, observacion: 'Existencia inicial', actor_email: email },
      });
    }
    return row;
  });
  return { id: r.id_biomed_repuesto };
}

/**
 * Movimiento: entrada (suma), salida (resta; no deja existencia negativa; puede ligarse al equipo donde se usó) o ajuste
 * (fija la existencia contada; exige motivo). Concurrencia: la actualización exige la existencia leída.
 */
export async function moverRepuesto(db: BiomedDb, access: BiomedAccess, idRepuesto: number, input: Record<string, unknown>, actor: InvActor) {
  puedeUsar(access);
  const tipo = String(input.tipo ?? '') as TipoMov;
  if (!TIPOS_MOV.includes(tipo)) throw new SgcError('Elija entrada, salida o ajuste.', 400);
  const rep = Number.isInteger(idRepuesto) ? await db.biomedRepuesto.findFirst({ where: { id_biomed_repuesto: idRepuesto, id_company: access.idCompany } }) : null;
  if (!rep) throw new SgcError('Repuesto no encontrado.', 404);
  if (!rep.activo) throw new SgcError('El repuesto está inactivo.', 409);
  const actual = Number(rep.stock);
  const cantidad = cantidadDe(input.cantidad, tipo === 'ajuste' ? 'la existencia contada' : 'la cantidad', tipo === 'ajuste');
  const observacion = texto(input.observacion, 'la observación', 1000);
  if (tipo === 'ajuste' && (!observacion || observacion.length < 5)) throw new SgcError('Escriba el motivo del ajuste (queda en el historial).', 400);
  const nuevo = tipo === 'entrada' ? actual + cantidad : tipo === 'salida' ? actual - cantidad : cantidad;
  if (nuevo < 0) throw new SgcError(`No hay existencia suficiente: quedan ${actual} ${rep.unidad}.`, 409);
  let idEquipo: number | null = null;
  if (tipo === 'salida' && input.idEquipo !== undefined && input.idEquipo !== null && input.idEquipo !== '') {
    const eq = await db.biomedEquipo.findFirst({ where: { id_biomed_equipo: Number(input.idEquipo), id_company: access.idCompany }, select: { id_biomed_equipo: true } });
    if (!eq) throw new SgcError('Equipo no encontrado.', 404);
    idEquipo = eq.id_biomed_equipo;
  }
  const email = lower(actor.email);
  const delta = tipo === 'ajuste' ? nuevo - actual : tipo === 'entrada' ? cantidad : -cantidad;
  await db.$transaction(async (tx) => {
    const upd = await tx.biomedRepuesto.updateMany({ where: { id_biomed_repuesto: rep.id_biomed_repuesto, stock: rep.stock }, data: { stock: nuevo, updated_by: email, updated_at: new Date() } });
    if (upd.count !== 1) throw new SgcError('La existencia cambió mientras tanto: vuelva a intentarlo.', 409);
    await tx.biomedRepuestoMov.create({
      data: {
        id_company: access.idCompany,
        id_biomed_repuesto: rep.id_biomed_repuesto,
        tipo,
        cantidad: Math.abs(delta),
        stock_resultante: nuevo,
        id_biomed_equipo: idEquipo,
        referencia: texto(input.referencia, 'la referencia', 100),
        observacion,
        actor_email: email,
      },
    });
  });
  return { stock: nuevo };
}

export async function movimientosRepuesto(db: BiomedDb, access: BiomedAccess, idRepuesto: number) {
  puedeUsar(access);
  const rep = await db.biomedRepuesto.findFirst({ where: { id_biomed_repuesto: idRepuesto, id_company: access.idCompany } });
  if (!rep) throw new SgcError('Repuesto no encontrado.', 404);
  const movs = await db.biomedRepuestoMov.findMany({ where: { id_company: access.idCompany, id_biomed_repuesto: idRepuesto }, orderBy: { id_biomed_repuesto_mov: 'desc' }, take: 300 });
  const eqIds = [...new Set(movs.map((m) => m.id_biomed_equipo).filter((x): x is number => x !== null))];
  const eqs = eqIds.length ? new Map((await db.biomedEquipo.findMany({ where: { id_biomed_equipo: { in: eqIds } }, select: { id_biomed_equipo: true, serie: true, equipo: true } })).map((e) => [e.id_biomed_equipo, e])) : new Map();
  return {
    repuesto: repuestoDto(rep),
    movimientos: movs.map((m) => ({
      id: m.id_biomed_repuesto_mov,
      tipo: m.tipo as TipoMov,
      cantidad: Number(m.cantidad),
      stockResultante: Number(m.stock_resultante),
      equipo: m.id_biomed_equipo ? (eqs.get(m.id_biomed_equipo) ? `${eqs.get(m.id_biomed_equipo)!.equipo} · ${eqs.get(m.id_biomed_equipo)!.serie}` : `#${m.id_biomed_equipo}`) : null,
      referencia: m.referencia,
      observacion: m.observacion,
      actor: m.actor_email,
      at: m.created_at.toISOString(),
    })),
  };
}
