import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../app/generated/prisma';
import { SgcError } from '../sgc/errors';
import type { BiomedAccess } from './access';

/**
 * INGENIERÍA BIOMÉDICA · INVENTARIO DE EQUIPOS (fase 2, 2026-11-10; reunión de Nicolás Rivera con
 * Juan Mora y formato OLP-GCC-04-FR-017). Un equipo por serie (única por empresa):
 *  - bodega → distribuido (cliente, sede, ciudad): queda BLOQUEADO para otro contrato;
 *  - distribuido → bodega (devuelto, se reutiliza) | faltante | dañado (con observación);
 *  - faltante o dañado → se cobra al cliente con el VALOR UNITARIO de su código interno, congelado
 *    al marcarlo; si el código aún no tiene valor, se toma cuando se le asigne;
 *  - faltante o dañado → bodega (apareció o se reparó), con justificación.
 * Todo cambio queda en el historial (solo inserción) con quién, cuándo y por qué. El ingeniero
 * biomédico y el comercial (Byron) tienen el mismo permiso: el del módulo.
 */

export type BiomedDb = PrismaClient;
export interface InvActor {
  email: string;
  ip?: string | null;
}

export const ESTADOS_EQUIPO = ['bodega', 'distribuido', 'faltante', 'danado'] as const;
export type EstadoEquipo = (typeof ESTADOS_EQUIPO)[number];
export const ETIQUETA_ESTADO: Record<EstadoEquipo, string> = { bodega: 'En bodega', distribuido: 'Distribuido', faltante: 'Faltante', danado: 'Dañado' };

export const ACCIONES_MOVIMIENTO = ['distribuir', 'devolver', 'faltante', 'danado', 'reintegrar'] as const;
export type AccionMovimiento = (typeof ACCIONES_MOVIMIENTO)[number];
/** De qué estados sale y a cuál llega cada acción. */
export const REGLAS_MOVIMIENTO: Record<AccionMovimiento, { desde: EstadoEquipo[]; hacia: EstadoEquipo }> = {
  distribuir: { desde: ['bodega'], hacia: 'distribuido' },
  devolver: { desde: ['distribuido'], hacia: 'bodega' },
  faltante: { desde: ['distribuido', 'bodega'], hacia: 'faltante' },
  danado: { desde: ['distribuido', 'bodega'], hacia: 'danado' },
  reintegrar: { desde: ['faltante', 'danado'], hacia: 'bodega' },
};

export const MAX_SELECCION = 6000;
export const MAX_PAGINA = 500;
const LOTE_SQL = 500;

/** Campos que se editan (y que trae el formato FR-017). */
export const CAMPOS_EQUIPO = ['codigo_interno', 'equipo', 'marca', 'modelo', 'serie', 'clasificacion_riesgo', 'registro_sanitario', 'cliente', 'sede', 'zona', 'ciudad'] as const;
export type CampoEquipo = (typeof CAMPOS_EQUIPO)[number];
export const LARGO_CAMPO: Record<CampoEquipo | 'item_code_sap' | 'observacion', number> = {
  codigo_interno: 50,
  equipo: 200,
  marca: 100,
  modelo: 150,
  serie: 100,
  clasificacion_riesgo: 20,
  registro_sanitario: 100,
  cliente: 200,
  sede: 200,
  zona: 100,
  ciudad: 100,
  item_code_sap: 50,
  observacion: 1000,
};
export const ETIQUETA_CAMPO: Record<CampoEquipo, string> = {
  codigo_interno: 'Código interno',
  equipo: 'Equipo',
  marca: 'Marca',
  modelo: 'Modelo',
  serie: 'Serie',
  clasificacion_riesgo: 'Clasificación de riesgo',
  registro_sanitario: 'Registro sanitario',
  cliente: 'Cliente',
  sede: 'Sede',
  zona: 'Zona',
  ciudad: 'Ciudad',
};

export type DatosEquipo = Record<CampoEquipo, string | null>;

export interface EquipoDto {
  id: number;
  codigoInterno: string | null;
  equipo: string;
  marca: string | null;
  modelo: string | null;
  serie: string;
  clasificacionRiesgo: string | null;
  registroSanitario: string | null;
  cliente: string | null;
  sede: string | null;
  zona: string | null;
  ciudad: string | null;
  estado: EstadoEquipo;
  itemCodeSap: string | null;
  observacion: string | null;
  valorCobro: number | null;
  novedadAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

type FilaEquipo = Awaited<ReturnType<BiomedDb['biomedEquipo']['findFirst']>> & {};

const lower = (s: string) => s.trim().toLowerCase();
const num = (d: unknown): number | null => (d === null || d === undefined ? null : Number(d));

function toDto(r: NonNullable<FilaEquipo>): EquipoDto {
  return {
    id: r.id_biomed_equipo,
    codigoInterno: r.codigo_interno,
    equipo: r.equipo,
    marca: r.marca,
    modelo: r.modelo,
    serie: r.serie,
    clasificacionRiesgo: r.clasificacion_riesgo,
    registroSanitario: r.registro_sanitario,
    cliente: r.cliente,
    sede: r.sede,
    zona: r.zona,
    ciudad: r.ciudad,
    estado: r.estado as EstadoEquipo,
    itemCodeSap: r.item_code_sap,
    observacion: r.observacion,
    valorCobro: num(r.valor_cobro),
    novedadAt: r.novedad_at?.toISOString() ?? null,
    updatedAt: (r.updated_at ?? r.created_at).toISOString(),
    updatedBy: r.updated_by ?? r.created_by,
  };
}

function puedeUsar(access: BiomedAccess) {
  if (!access.canUse) throw new SgcError('Sin acceso al inventario de Ingeniería biomédica.', 403);
}

/** Texto limpio (o null si queda vacío); demasiado largo es un error. */
export function limpio(v: unknown, campo: keyof typeof LARGO_CAMPO, etiqueta = campo as string): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length > LARGO_CAMPO[campo]) throw new SgcError(`${etiqueta}: máximo ${LARGO_CAMPO[campo]} caracteres.`, 400);
  return s;
}

function justificacionDe(v: unknown, obligatoria: boolean, que = 'la justificación'): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) {
    if (obligatoria) throw new SgcError(`Escriba ${que} (queda en el historial).`, 400);
    return null;
  }
  if (s.length < 5) throw new SgcError(`Escriba ${que} completa (mínimo 5 caracteres).`, 400);
  return s.slice(0, 1000);
}

/** «Bodega» (en cualquier forma) es la bodega; otra sede o un cliente es distribuido. */
export function esBodega(sede: string | null | undefined): boolean {
  return (sede ?? '').trim().toLowerCase() === 'bodega';
}
export function estadoPorUbicacion(d: Pick<DatosEquipo, 'sede' | 'cliente'>): EstadoEquipo {
  return !d.sede || esBodega(d.sede) ? 'bodega' : 'distribuido';
}

const ubicacion = (r: { estado: string; cliente: string | null; sede: string | null; zona: string | null; ciudad: string | null; valor_cobro?: unknown }) => ({
  estado: r.estado,
  cliente: r.cliente,
  sede: r.sede,
  zona: r.zona,
  ciudad: r.ciudad,
  ...(r.valor_cobro !== undefined && r.valor_cobro !== null ? { valorCobro: Number(r.valor_cobro) } : {}),
});

async function eventos(
  db: Pick<BiomedDb, 'biomedEquipoEvento'>,
  idCompany: number,
  filas: { id: number | null; accion: string; antes?: unknown; despues?: unknown; justificacion?: string | null }[],
  actor: InvActor,
  lote: string | null
) {
  for (let i = 0; i < filas.length; i += 100) {
    await db.biomedEquipoEvento.createMany({
      data: filas.slice(i, i + 100).map((f) => ({
        id_company: idCompany,
        id_biomed_equipo: f.id,
        accion: f.accion,
        antes: f.antes === undefined ? null : JSON.stringify(f.antes),
        despues: f.despues === undefined ? null : JSON.stringify(f.despues),
        justificacion: f.justificacion ?? null,
        lote,
        actor_email: lower(actor.email),
        ip: actor.ip ?? null,
      })),
    });
  }
}

// ── Consulta ──────────────────────────────────────────────────────────────

export interface FiltroInventario {
  q?: string | null;
  estado?: string | null;
  cliente?: string | null;
  ciudad?: string | null;
  codigo?: string | null;
}

function whereDe(access: BiomedAccess, f: FiltroInventario) {
  const q = (f.q ?? '').trim().slice(0, 100);
  const estado = (ESTADOS_EQUIPO as readonly string[]).includes(f.estado ?? '') ? f.estado! : null;
  return {
    id_company: access.idCompany,
    ...(estado ? { estado } : {}),
    ...(f.cliente ? { cliente: f.cliente } : {}),
    ...(f.ciudad ? { ciudad: f.ciudad } : {}),
    ...(f.codigo ? { codigo_interno: f.codigo } : {}),
    ...(q.length >= 2
      ? { OR: [{ serie: { contains: q } }, { equipo: { contains: q } }, { modelo: { contains: q } }, { cliente: { contains: q } }, { sede: { contains: q } }, { item_code_sap: { contains: q } }] }
      : {}),
  };
}

export interface ResumenInventario {
  total: number;
  porEstado: Record<EstadoEquipo, number>;
  clientes: string[];
  ciudades: string[];
  codigos: string[];
  /** Cliente y ciudad más usados en bodega (para prellenar la devolución). */
  bodega: { cliente: string | null; ciudad: string | null };
}

export async function resumenInventario(db: BiomedDb, access: BiomedAccess): Promise<ResumenInventario> {
  puedeUsar(access);
  const where = { id_company: access.idCompany };
  const [estados, clientes, ciudades, codigos, enBodega] = await Promise.all([
    db.biomedEquipo.groupBy({ by: ['estado'], where, _count: { _all: true } }),
    db.biomedEquipo.groupBy({ by: ['cliente'], where }),
    db.biomedEquipo.groupBy({ by: ['ciudad'], where }),
    db.biomedEquipo.groupBy({ by: ['codigo_interno'], where }),
    db.biomedEquipo.groupBy({ by: ['cliente', 'ciudad'], where: { ...where, estado: 'bodega' }, _count: { _all: true } }),
  ]);
  const habitual = [...enBodega].sort((a, b) => b._count._all - a._count._all)[0];
  const porEstado = { bodega: 0, distribuido: 0, faltante: 0, danado: 0 } as Record<EstadoEquipo, number>;
  for (const e of estados) if (e.estado in porEstado) porEstado[e.estado as EstadoEquipo] = e._count._all;
  const lista = (xs: (string | null)[]) => xs.filter((x): x is string => Boolean(x)).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  return {
    total: Object.values(porEstado).reduce((a, b) => a + b, 0),
    porEstado,
    clientes: lista(clientes.map((c) => c.cliente)),
    ciudades: lista(ciudades.map((c) => c.ciudad)),
    codigos: lista(codigos.map((c) => c.codigo_interno)),
    bodega: { cliente: habitual?.cliente ?? null, ciudad: habitual?.ciudad ?? null },
  };
}

export async function listEquipos(db: BiomedDb, access: BiomedAccess, f: FiltroInventario & { page?: unknown; pageSize?: unknown }) {
  puedeUsar(access);
  const pageSize = Math.min(MAX_PAGINA, Math.max(10, Math.floor(Number(f.pageSize) || 100)));
  const page = Math.max(1, Math.floor(Number(f.page) || 1));
  const where = whereDe(access, f);
  const [total, rows] = await Promise.all([
    db.biomedEquipo.count({ where }),
    db.biomedEquipo.findMany({ where, orderBy: [{ codigo_interno: 'asc' }, { serie: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { total, page, pageSize, equipos: rows.map(toDto) };
}

/** Los id de lo filtrado (para «seleccionar todos»), hasta MAX_SELECCION. */
export async function idsFiltrados(db: BiomedDb, access: BiomedAccess, f: FiltroInventario) {
  puedeUsar(access);
  const rows = await db.biomedEquipo.findMany({ where: whereDe(access, f), select: { id_biomed_equipo: true }, orderBy: [{ codigo_interno: 'asc' }, { serie: 'asc' }], take: MAX_SELECCION + 1 });
  if (rows.length > MAX_SELECCION) throw new SgcError(`Hay más de ${MAX_SELECCION} equipos con ese filtro: acótelo.`, 400);
  return rows.map((r) => r.id_biomed_equipo);
}

export async function historialEquipo(db: BiomedDb, access: BiomedAccess, idEquipo: number) {
  puedeUsar(access);
  const eq = await db.biomedEquipo.findFirst({ where: { id_biomed_equipo: idEquipo, id_company: access.idCompany } });
  if (!eq) throw new SgcError('Equipo no encontrado.', 404);
  const ev = await db.biomedEquipoEvento.findMany({ where: { id_company: access.idCompany, id_biomed_equipo: idEquipo }, orderBy: { created_at: 'desc' }, take: 200 });
  return {
    equipo: toDto(eq),
    historial: ev.map((e) => ({
      id: e.id_biomed_equipo_evento,
      accion: e.accion,
      antes: e.antes ? (JSON.parse(e.antes) as Record<string, unknown>) : null,
      despues: e.despues ? (JSON.parse(e.despues) as Record<string, unknown>) : null,
      justificacion: e.justificacion,
      actor: e.actor_email,
      at: e.created_at.toISOString(),
    })),
  };
}

// ── Alta y edición (control de cambios) ───────────────────────────────────

/** La serie es única (también la base lo garantiza: dos personas a la vez). */
function serieRepetida(e: unknown, serie: string): never {
  if ((e as { code?: string })?.code === 'P2002') throw new SgcError(`La serie ${serie} ya está en el inventario.`, 409);
  throw e;
}

export function datosDe(input: Record<string, unknown>, parcial = false): Partial<DatosEquipo> {
  const out: Partial<DatosEquipo> = {};
  const camel: Record<CampoEquipo, string> = {
    codigo_interno: 'codigoInterno',
    equipo: 'equipo',
    marca: 'marca',
    modelo: 'modelo',
    serie: 'serie',
    clasificacion_riesgo: 'clasificacionRiesgo',
    registro_sanitario: 'registroSanitario',
    cliente: 'cliente',
    sede: 'sede',
    zona: 'zona',
    ciudad: 'ciudad',
  };
  for (const c of CAMPOS_EQUIPO) {
    const k = camel[c];
    if (parcial && !(k in input)) continue;
    out[c] = limpio(input[k], c, ETIQUETA_CAMPO[c]);
  }
  return out;
}

export async function crearEquipo(db: BiomedDb, access: BiomedAccess, input: Record<string, unknown>, actor: InvActor) {
  puedeUsar(access);
  const d = datosDe(input) as DatosEquipo;
  if (!d.equipo) throw new SgcError('Escriba el equipo.', 400);
  if (!d.serie) throw new SgcError('Escriba la serie.', 400);
  if (await db.biomedEquipo.findFirst({ where: { id_company: access.idCompany, serie: d.serie }, select: { id_biomed_equipo: true } })) {
    throw new SgcError(`La serie ${d.serie} ya está en el inventario.`, 409);
  }
  const estado = estadoPorUbicacion(d);
  const row = await db.biomedEquipo
    .create({ data: { id_company: access.idCompany, ...d, equipo: d.equipo, serie: d.serie, estado, created_by: lower(actor.email) } })
    .catch((e: unknown) => serieRepetida(e, d.serie!));
  await eventos(db, access.idCompany, [{ id: row.id_biomed_equipo, accion: 'alta', despues: { ...d, estado }, justificacion: justificacionDe(input.justificacion, false) }], actor, null);
  return { id: row.id_biomed_equipo };
}

/** Cambia los datos de UN equipo (no su estado): exige justificación; cambiar la serie es «cambio de serial». */
export async function editarEquipo(db: BiomedDb, access: BiomedAccess, idEquipo: number, input: Record<string, unknown>, actor: InvActor) {
  puedeUsar(access);
  const eq = await db.biomedEquipo.findFirst({ where: { id_biomed_equipo: idEquipo, id_company: access.idCompany } });
  if (!eq) throw new SgcError('Equipo no encontrado.', 404);
  const nuevos = datosDe(input, true);
  const antes: Record<string, unknown> = {};
  const despues: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(nuevos) as [CampoEquipo, string | null][]) {
    if ((eq[c] ?? null) !== v) {
      antes[c] = eq[c] ?? null;
      despues[c] = v;
    }
  }
  if ('equipo' in despues && !despues.equipo) throw new SgcError('El equipo no puede quedar vacío.', 400);
  if ('serie' in despues && !despues.serie) throw new SgcError('La serie no puede quedar vacía.', 400);
  if (Object.keys(despues).length === 0) return { changed: false };
  const justificacion = justificacionDe(input.justificacion, true, 'por qué se cambia');
  if (despues.serie && (await db.biomedEquipo.findFirst({ where: { id_company: access.idCompany, serie: String(despues.serie) }, select: { id_biomed_equipo: true } }))) {
    throw new SgcError(`La serie ${String(despues.serie)} ya está en el inventario.`, 409);
  }
  await db.biomedEquipo
    .update({ where: { id_biomed_equipo: eq.id_biomed_equipo }, data: { ...despues, updated_by: lower(actor.email), updated_at: new Date() } })
    .catch((e: unknown) => serieRepetida(e, String(despues.serie ?? eq.serie)));
  await eventos(db, access.idCompany, [{ id: eq.id_biomed_equipo, accion: 'serie' in despues ? 'cambio_serial' : 'edicion', antes, despues, justificacion }], actor, null);
  return { changed: true };
}

// ── Movimientos (distribuir, devolver, faltante, dañado, reintegrar) ──────

function idsDe(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new SgcError('Seleccione al menos un equipo.', 400);
  const ids = [...new Set(raw.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n < 1)) throw new SgcError('Selección inválida.', 400);
  if (ids.length > MAX_SELECCION) throw new SgcError(`Máximo ${MAX_SELECCION} equipos por operación.`, 400);
  return ids;
}

async function equiposDe(db: BiomedDb, access: BiomedAccess, ids: number[]) {
  const rows: NonNullable<FilaEquipo>[] = [];
  for (let i = 0; i < ids.length; i += LOTE_SQL) {
    rows.push(...(await db.biomedEquipo.findMany({ where: { id_company: access.idCompany, id_biomed_equipo: { in: ids.slice(i, i + LOTE_SQL) } } })));
  }
  if (rows.length !== ids.length) throw new SgcError('Algún equipo seleccionado ya no está en el inventario: recargue.', 409);
  return rows;
}

async function valoresPorCodigo(db: BiomedDb, idCompany: number, codigos: (string | null)[]) {
  const lista = [...new Set(codigos.filter((c): c is string => Boolean(c)))];
  if (lista.length === 0) return new Map<string, number>();
  const vs = await db.biomedValorUnitario.findMany({ where: { id_company: idCompany, codigo_interno: { in: lista } } });
  return new Map(vs.map((v) => [v.codigo_interno, Number(v.valor)]));
}

export interface MovimientoInput {
  accion?: unknown;
  ids?: unknown;
  cliente?: unknown;
  sede?: unknown;
  zona?: unknown;
  ciudad?: unknown;
  observacion?: unknown;
}

export async function moverEquipos(db: BiomedDb, access: BiomedAccess, input: MovimientoInput, actor: InvActor) {
  puedeUsar(access);
  const accion = String(input.accion ?? '') as AccionMovimiento;
  const regla = REGLAS_MOVIMIENTO[accion];
  if (!regla) throw new SgcError('Acción inválida.', 400);
  const ids = idsDe(input.ids);
  const rows = await equiposDe(db, access, ids);
  const fuera = rows.filter((r) => !regla.desde.includes(r.estado as EstadoEquipo));
  if (fuera.length > 0) {
    const ej = fuera.slice(0, 5).map((r) => `${r.serie} (${ETIQUETA_ESTADO[r.estado as EstadoEquipo] ?? r.estado})`).join(', ');
    throw new SgcError(`${fuera.length} equipo(s) no se pueden ${textoAccion(accion)} por su estado: ${ej}${fuera.length > 5 ? '…' : ''}.`, 409);
  }

  // Ubicación nueva: al distribuir, la del cliente; al volver a bodega, la de la bodega.
  let destino: Pick<DatosEquipo, 'cliente' | 'sede' | 'zona' | 'ciudad'> | null = null;
  if (accion === 'distribuir' || accion === 'devolver' || accion === 'reintegrar') {
    destino = {
      cliente: limpio(input.cliente, 'cliente', 'Cliente'),
      sede: limpio(input.sede, 'sede', 'Sede') ?? (accion === 'distribuir' ? null : 'Bodega'),
      zona: limpio(input.zona, 'zona', 'Zona'),
      ciudad: limpio(input.ciudad, 'ciudad', 'Ciudad'),
    };
    if (accion === 'distribuir') {
      if (!destino.cliente || !destino.sede || !destino.ciudad) throw new SgcError('Para distribuir indique cliente, sede y ciudad.', 400);
      if (esBodega(destino.sede)) throw new SgcError('La sede de destino no puede ser la bodega.', 400);
    } else if (!esBodega(destino.sede)) {
      throw new SgcError('Al volver a bodega la sede es «Bodega».', 400);
    }
  }
  const obligatoria = accion === 'faltante' || accion === 'danado' || accion === 'reintegrar';
  const observacion = justificacionDe(input.observacion, obligatoria, accion === 'reintegrar' ? 'por qué vuelve a bodega' : 'la observación');

  const now = new Date();
  const lote = randomUUID().slice(0, 18);
  const email = lower(actor.email);
  const valores = accion === 'faltante' || accion === 'danado' ? await valoresPorCodigo(db, access.idCompany, rows.map((r) => r.codigo_interno)) : new Map<string, number>();

  // Grupos con el mismo resultado (el valor de cobro depende del código interno).
  const grupos = new Map<string, { ids: number[]; data: Record<string, unknown> }>();
  const evs: Parameters<typeof eventos>[2] = [];
  for (const r of rows) {
    let data: Record<string, unknown>;
    if (destino) {
      data = { estado: regla.hacia, ...destino, observacion, valor_cobro: null, novedad_at: null };
    } else {
      const valor = r.codigo_interno ? (valores.get(r.codigo_interno) ?? null) : null;
      data = { estado: regla.hacia, observacion, valor_cobro: valor, novedad_at: now };
    }
    const key = JSON.stringify(data);
    if (!grupos.has(key)) grupos.set(key, { ids: [], data });
    grupos.get(key)!.ids.push(r.id_biomed_equipo);
    evs.push({ id: r.id_biomed_equipo, accion, antes: ubicacion(r), despues: ubicacion({ ...r, ...(data as object) } as typeof r), justificacion: observacion });
  }

  await db.$transaction(
    async (tx) => {
      for (const g of grupos.values()) {
        for (let i = 0; i < g.ids.length; i += LOTE_SQL) {
          await tx.biomedEquipo.updateMany({ where: { id_company: access.idCompany, id_biomed_equipo: { in: g.ids.slice(i, i + LOTE_SQL) } }, data: { ...g.data, updated_by: email, updated_at: now } });
        }
      }
      await eventos(tx, access.idCompany, evs, actor, lote);
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
  return { movidos: rows.length, lote };
}

function textoAccion(a: AccionMovimiento) {
  return { distribuir: 'distribuir', devolver: 'devolver', faltante: 'marcar como faltantes', danado: 'marcar como dañados', reintegrar: 'reintegrar a bodega' }[a];
}

// ── Artículo de SAP (opcional) ────────────────────────────────────────────

export async function asignarArticuloSap(db: BiomedDb, access: BiomedAccess, input: { ids?: unknown; itemCode?: unknown; itemName?: unknown }, actor: InvActor) {
  puedeUsar(access);
  const ids = idsDe(input.ids);
  const itemCode = limpio(input.itemCode, 'item_code_sap', 'Artículo de SAP');
  const rows = await equiposDe(db, access, ids);
  const now = new Date();
  const lote = randomUUID().slice(0, 18);
  const nombre = typeof input.itemName === 'string' ? input.itemName.slice(0, 200) : null;
  await db.$transaction(
    async (tx) => {
      for (let i = 0; i < ids.length; i += LOTE_SQL) {
        await tx.biomedEquipo.updateMany({ where: { id_company: access.idCompany, id_biomed_equipo: { in: ids.slice(i, i + LOTE_SQL) } }, data: { item_code_sap: itemCode, updated_by: lower(actor.email), updated_at: now } });
      }
      await eventos(
        tx,
        access.idCompany,
        rows.filter((r) => (r.item_code_sap ?? null) !== itemCode).map((r) => ({ id: r.id_biomed_equipo, accion: 'articulo_sap', antes: { itemCodeSap: r.item_code_sap }, despues: { itemCodeSap: itemCode, ...(nombre ? { itemName: nombre } : {}) } })),
        actor,
        lote
      );
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
  return { asignados: rows.length };
}

// ── Valores unitarios y cobros ────────────────────────────────────────────

export async function listValores(db: BiomedDb, access: BiomedAccess) {
  puedeUsar(access);
  const [porCodigo, valores] = await Promise.all([
    db.biomedEquipo.groupBy({ by: ['codigo_interno', 'equipo', 'modelo'], where: { id_company: access.idCompany }, _count: { _all: true } }),
    db.biomedValorUnitario.findMany({ where: { id_company: access.idCompany } }),
  ]);
  const vs = new Map(valores.map((v) => [v.codigo_interno, v]));
  const m = new Map<string, { codigo: string; descripciones: string[]; equipos: number }>();
  for (const g of porCodigo) {
    if (!g.codigo_interno) continue;
    const x = m.get(g.codigo_interno) ?? { codigo: g.codigo_interno, descripciones: [], equipos: 0 };
    x.equipos += g._count._all;
    const desc = [g.equipo, g.modelo].filter(Boolean).join(' · ');
    if (desc && !x.descripciones.includes(desc)) x.descripciones.push(desc);
    m.set(g.codigo_interno, x);
  }
  for (const v of valores) if (!m.has(v.codigo_interno)) m.set(v.codigo_interno, { codigo: v.codigo_interno, descripciones: [], equipos: 0 });
  return [...m.values()]
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
    .map((x) => {
      const v = vs.get(x.codigo);
      return { ...x, valor: v ? Number(v.valor) : null, updatedBy: v?.updated_by ?? null, updatedAt: v?.updated_at.toISOString() ?? null };
    });
}

/**
 * Guarda el valor unitario de un código interno. Lo ya marcado como faltante o dañado conserva el valor
 * con que se marcó; los que se marcaron cuando el código aún no tenía valor lo toman ahora.
 */
export async function saveValor(db: BiomedDb, access: BiomedAccess, input: { codigo?: unknown; valor?: unknown }, actor: InvActor) {
  puedeUsar(access);
  const codigo = limpio(input.codigo, 'codigo_interno', 'Código interno');
  if (!codigo) throw new SgcError('Indique el código interno.', 400);
  const valor = Number(input.valor);
  if (!Number.isFinite(valor) || valor < 0 || valor > 1e13) throw new SgcError('El valor unitario debe ser un número mayor o igual a cero.', 400);
  const redondeado = Math.round(valor * 100) / 100;
  const previo = await db.biomedValorUnitario.findFirst({ where: { id_company: access.idCompany, codigo_interno: codigo } });
  const now = new Date();
  await db.biomedValorUnitario.upsert({
    where: { id_company_codigo_interno: { id_company: access.idCompany, codigo_interno: codigo } },
    create: { id_company: access.idCompany, codigo_interno: codigo, valor: redondeado, updated_by: lower(actor.email), updated_at: now },
    update: { valor: redondeado, updated_by: lower(actor.email), updated_at: now },
  });
  const pendientes = await db.biomedEquipo.updateMany({
    where: { id_company: access.idCompany, codigo_interno: codigo, estado: { in: ['faltante', 'danado'] }, valor_cobro: null },
    data: { valor_cobro: redondeado, updated_by: lower(actor.email), updated_at: now },
  });
  await eventos(db, access.idCompany, [{ id: null, accion: 'valor_unitario', antes: { codigo, valor: previo ? Number(previo.valor) : null }, despues: { codigo, valor: redondeado, cobrosCompletados: pendientes.count } }], actor, null);
  return { codigo, valor: redondeado, cobrosCompletados: pendientes.count };
}

/** Cobro por cliente de los equipos faltantes o dañados (valor congelado al marcarlos). */
export async function cobros(db: BiomedDb, access: BiomedAccess) {
  puedeUsar(access);
  const rows = await db.biomedEquipo.findMany({ where: { id_company: access.idCompany, estado: { in: ['faltante', 'danado'] } }, orderBy: [{ cliente: 'asc' }, { serie: 'asc' }] });
  const porCliente = new Map<string, { cliente: string; faltantes: number; danados: number; total: number; sinValor: number }>();
  for (const r of rows) {
    const cliente = r.cliente || '(sin cliente)';
    const x = porCliente.get(cliente) ?? { cliente, faltantes: 0, danados: 0, total: 0, sinValor: 0 };
    if (r.estado === 'faltante') x.faltantes += 1;
    else x.danados += 1;
    if (r.valor_cobro === null) x.sinValor += 1;
    else x.total = Math.round((x.total + Number(r.valor_cobro)) * 100) / 100;
    porCliente.set(cliente, x);
  }
  const clientes = [...porCliente.values()].sort((a, b) => b.total - a.total || a.cliente.localeCompare(b.cliente, 'es'));
  return {
    clientes,
    total: Math.round(clientes.reduce((a, c) => a + c.total, 0) * 100) / 100,
    sinValor: clientes.reduce((a, c) => a + c.sinValor, 0),
    equipos: rows.map(toDto),
  };
}

// ── Cargue masivo (con simulación) ────────────────────────────────────────

export interface FilaCargue {
  fila: number;
  datos: DatosEquipo;
}
export interface ErrorCargue {
  fila: number;
  serie: string | null;
  motivo: string;
}

const COMPARABLES: CampoEquipo[] = CAMPOS_EQUIPO.filter((c) => c !== 'serie');

/** Compara el archivo con el inventario: qué es nuevo, qué cambia y qué no está en el archivo. */
export async function simularCargue(db: BiomedDb, access: BiomedAccess, filas: FilaCargue[], errores: ErrorCargue[]) {
  puedeUsar(access);
  const existentes = await db.biomedEquipo.findMany({ where: { id_company: access.idCompany } });
  const porSerie = new Map(existentes.map((e) => [e.serie.toLowerCase(), e]));
  const nuevos: FilaCargue[] = [];
  const cambios: { fila: number; id: number; serie: string; campos: { campo: CampoEquipo; antes: string | null; despues: string | null }[]; estado: { antes: string; despues: string } | null }[] = [];
  let iguales = 0;
  const enArchivo = new Set<string>();
  for (const f of filas) {
    const serie = f.datos.serie!.toLowerCase();
    enArchivo.add(serie);
    const e = porSerie.get(serie);
    if (!e) {
      nuevos.push(f);
      continue;
    }
    const campos = COMPARABLES.filter((c) => (e[c] ?? null) !== (f.datos[c] ?? null)).map((c) => ({ campo: c, antes: e[c] ?? null, despues: f.datos[c] ?? null }));
    // El estado sigue a la ubicación solo para lo que está en bodega o distribuido; faltante o dañado no lo cambia un archivo.
    const estadoNuevo = e.estado === 'bodega' || e.estado === 'distribuido' ? estadoPorUbicacion(f.datos) : e.estado;
    const estado = estadoNuevo !== e.estado ? { antes: e.estado, despues: estadoNuevo } : null;
    if (campos.length === 0 && !estado) iguales += 1;
    else cambios.push({ fila: f.fila, id: e.id_biomed_equipo, serie: e.serie, campos, estado });
  }
  const noEnArchivo = existentes.filter((e) => !enArchivo.has(e.serie.toLowerCase())).length;
  return { leidas: filas.length + errores.length, nuevos, cambios, iguales, errores, noEnArchivo };
}

export async function aplicarCargue(db: BiomedDb, access: BiomedAccess, filas: FilaCargue[], errores: ErrorCargue[], input: { justificacion?: unknown; nombreArchivo?: string }, actor: InvActor) {
  const sim = await simularCargue(db, access, filas, errores);
  if (sim.errores.length > 0) throw new SgcError(`El archivo tiene ${sim.errores.length} fila(s) con error: corríjalas y simule de nuevo.`, 400);
  if (sim.nuevos.length === 0 && sim.cambios.length === 0) return { creados: 0, actualizados: 0, iguales: sim.iguales, lote: null };
  const justificacion = justificacionDe(input.justificacion, sim.cambios.length > 0, 'por qué se actualiza el inventario con este archivo');
  const lote = randomUUID().slice(0, 18);
  const email = lower(actor.email);
  const now = new Date();
  const archivo = (input.nombreArchivo ?? '').slice(0, 200) || null;

  await db.$transaction(
    async (tx) => {
      for (let i = 0; i < sim.nuevos.length; i += 100) {
        const parte = sim.nuevos.slice(i, i + 100);
        await tx.biomedEquipo.createMany({
          data: parte.map((f) => ({ id_company: access.idCompany, ...f.datos, equipo: f.datos.equipo!, serie: f.datos.serie!, estado: estadoPorUbicacion(f.datos), created_by: email, created_at: now })),
        });
      }
      if (sim.nuevos.length > 0) {
        const creados: { id_biomed_equipo: number; serie: string; estado: string }[] = [];
        const series = sim.nuevos.map((f) => f.datos.serie!);
        for (let i = 0; i < series.length; i += LOTE_SQL) {
          creados.push(...(await tx.biomedEquipo.findMany({ where: { id_company: access.idCompany, serie: { in: series.slice(i, i + LOTE_SQL) } }, select: { id_biomed_equipo: true, serie: true, estado: true } })));
        }
        await eventos(tx, access.idCompany, creados.map((c) => ({ id: c.id_biomed_equipo, accion: 'carga', despues: { estado: c.estado, archivo }, justificacion })), actor, lote);
      }
      for (const c of sim.cambios) {
        const data: Record<string, unknown> = Object.fromEntries(c.campos.map((x) => [x.campo, x.despues]));
        if (c.estado) data.estado = c.estado.despues;
        await tx.biomedEquipo.update({ where: { id_biomed_equipo: c.id }, data: { ...data, updated_by: email, updated_at: now } });
      }
      await eventos(
        tx,
        access.idCompany,
        sim.cambios.map((c) => ({
          id: c.id,
          accion: 'carga_cambio',
          antes: { ...Object.fromEntries(c.campos.map((x) => [x.campo, x.antes])), ...(c.estado ? { estado: c.estado.antes } : {}) },
          despues: { ...Object.fromEntries(c.campos.map((x) => [x.campo, x.despues])), ...(c.estado ? { estado: c.estado.despues } : {}), archivo },
          justificacion,
        })),
        actor,
        lote
      );
    },
    { timeout: 300_000, maxWait: 10_000 }
  );
  return { creados: sim.nuevos.length, actualizados: sim.cambios.length, iguales: sim.iguales, lote };
}
