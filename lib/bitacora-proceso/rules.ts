import {
  isOtIcono,
  OT_LIMITS,
  OT_TURNOS,
  otPermissionFromUrl,
  type OtIcono,
  type OtEstado,
  type OtTurno,
} from './constants';

/**
 * Reglas de negocio de la Bitácora de Proceso — funciones PURAS (probadas con Vitest).
 * Las rutas las usan para decidir; la base las refuerza (CHECK y triggers).
 */

/** Error de negocio con su código HTTP (las rutas lo traducen tal cual). */
export class OtError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'OtError';
  }
}

export function isOtError(e: unknown): e is OtError {
  return e instanceof OtError;
}

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------

export interface OtGrantRow {
  subprocessUrl: string | null | undefined;
  idCompany: number;
  companyName: string;
}

/** Acceso efectivo de una persona en UNA empresa. Gestión implica operario. */
export interface OtCompanyAccess {
  idCompany: number;
  companyName: string;
  canOperate: boolean;
  canManage: boolean;
}

/** Resuelve el acceso por empresa desde las filas de permiso (ignora URLs ajenas). */
export function resolveOtAccess(rows: readonly OtGrantRow[]): OtCompanyAccess[] {
  const byCompany = new Map<number, OtCompanyAccess>();
  for (const row of rows) {
    const perm = otPermissionFromUrl(row.subprocessUrl);
    if (!perm) continue;
    let entry = byCompany.get(row.idCompany);
    if (!entry) {
      entry = { idCompany: row.idCompany, companyName: row.companyName, canOperate: false, canManage: false };
      byCompany.set(row.idCompany, entry);
    }
    if (perm === 'gestion') entry.canManage = true;
    entry.canOperate = true;
  }
  return [...byCompany.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, 'es'));
}

export function companyOtAccess(
  access: readonly OtCompanyAccess[],
  idCompany: number,
  need: 'canOperate' | 'canManage' = 'canOperate'
): OtCompanyAccess | null {
  const entry = access.find((a) => a.idCompany === idCompany);
  return entry && entry[need] ? entry : null;
}

/**
 * ¿Puede esta persona registrar en la bitácora? (R3, R8, R15)
 * - la bitácora debe estar ABIERTA (409 si está cerrada);
 * - un supervisor (Gestión) registra en cualquier bitácora abierta de su empresa;
 * - los demás, solo si figuran como AUXILIAR o como INSPECTOR de esa bitácora (403).
 *   (`operarios` = auxiliares; el inspector registra igual que ellos.)
 */
export function assertPuedeRegistrar(
  orden: { estado: string; operarios: readonly string[]; inspector?: string | null },
  idUser: string,
  access: OtCompanyAccess
): void {
  if (orden.estado !== 'ABIERTA') {
    throw new OtError('La bitácora está cerrada: ya no admite registros.', 409);
  }
  if (access.canManage) return;
  if (!orden.operarios.includes(idUser) && orden.inspector !== idUser) {
    throw new OtError(
      'Usted no figura como auxiliar ni como inspector de esta bitácora. Pida al supervisor que lo incluya.',
      403
    );
  }
}

// ---------------------------------------------------------------------------
// Validación de entradas
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function optStr(v: unknown, max: number, campo: string): string | null {
  const s = str(v);
  if (!s) return null;
  if (s.length > max) throw new OtError(`${campo}: máximo ${max} caracteres.`, 400);
  return s;
}

function reqStr(v: unknown, max: number, campo: string): string {
  const s = str(v);
  if (!s) throw new OtError(`${campo} es obligatorio.`, 400);
  if (s.length > max) throw new OtError(`${campo}: máximo ${max} caracteres.`, 400);
  return s;
}

function optPositiveInt(v: unknown, campo: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new OtError(`${campo} no es válido.`, 400);
  return n;
}

/** Copia de la OP de SAP que se guarda en la orden (solo los campos conocidos). */
export interface SapOpSnapshot {
  AbsoluteEntry: number;
  DocumentNumber: number;
  ItemNo: string | null;
  ProductDescription: string | null;
  U_Cod_Lote: string | null;
  U_FecVen_lote: string | null;
  PlannedQuantity: number | null;
  Warehouse: string | null;
}

export interface NuevaOrdenInput {
  idCompany: number;
  producto: string;
  itemCode: string | null;
  lote: string;
  turno: OtTurno;
  area: string | null;
  /** Auxiliares (en la base, ot_orden_operario). */
  operarios: string[];
  inspector: string;
  sapOp: SapOpSnapshot | null;
}

function parseSapOp(v: unknown): SapOpSnapshot | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new OtError('La orden de producción de SAP no es válida.', 400);
  const o = v as Record<string, unknown>;
  const abs = optPositiveInt(o.AbsoluteEntry, 'La orden de producción de SAP');
  const doc = optPositiveInt(o.DocumentNumber, 'La orden de producción de SAP');
  if (!abs || !doc) throw new OtError('La orden de producción de SAP no es válida.', 400);
  const s = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
  const qty = typeof o.PlannedQuantity === 'number' && Number.isFinite(o.PlannedQuantity) ? o.PlannedQuantity : null;
  return {
    AbsoluteEntry: abs,
    DocumentNumber: doc,
    ItemNo: s(o.ItemNo, 50),
    ProductDescription: s(o.ProductDescription, 200),
    U_Cod_Lote: s(o.U_Cod_Lote, 50),
    U_FecVen_lote: s(o.U_FecVen_lote, 40),
    PlannedQuantity: qty,
    Warehouse: s(o.Warehouse, 20),
  };
}

/** Valida el cuerpo de «Nueva orden de trabajo» (R2, R3, R11). */
export function parseNuevaOrden(body: Record<string, unknown> | null): NuevaOrdenInput {
  if (!body) throw new OtError('Se esperaba un JSON con la bitácora.', 400);
  const idCompany = optPositiveInt(body.company, 'La empresa');
  if (!idCompany) throw new OtError('Falta la empresa.', 400);
  const turno = str(body.turno).toUpperCase();
  if (!(OT_TURNOS as readonly string[]).includes(turno)) {
    throw new OtError('El turno es obligatorio (Mañana, Tarde o Noche).', 400);
  }
  const rawOps = Array.isArray(body.operarios) ? body.operarios : [];
  const operarios = [...new Set(rawOps.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean))];
  if (operarios.length === 0) throw new OtError('Seleccione al menos un auxiliar.', 400);
  if (operarios.length > OT_LIMITS.maxOperarios) {
    throw new OtError(`Máximo ${OT_LIMITS.maxOperarios} auxiliares por bitácora.`, 400);
  }
  if (operarios.some((id) => id.length > 50)) throw new OtError('Auxiliar no válido.', 400);
  const inspector = str(body.inspector);
  if (!inspector) throw new OtError('Seleccione el inspector.', 400);
  if (inspector.length > 50) throw new OtError('Inspector no válido.', 400);
  return {
    idCompany,
    producto: reqStr(body.producto, OT_LIMITS.producto, 'El producto'),
    itemCode: optStr(body.itemCode, OT_LIMITS.itemCode, 'El código del artículo'),
    lote: reqStr(body.lote, OT_LIMITS.lote, 'El lote'),
    turno: turno as OtTurno,
    area: optStr(body.area, OT_LIMITS.area, 'El área'),
    operarios,
    inspector,
    sapOp: parseSapOp(body.sapOp),
  };
}

export interface NuevoRegistroInput {
  idActividad: number;
  observacion: string | null;
}

/**
 * Valida el cuerpo de un registro (R4, R5, R6). Cualquier hora que envíe el
 * cliente (`registrado_en`, `fecha`, `hora`…) se IGNORA: solo se leen la
 * actividad y la observación; la hora la pone la base de datos.
 */
export function parseNuevoRegistro(body: Record<string, unknown> | null): NuevoRegistroInput {
  if (!body) throw new OtError('Se esperaba un JSON con el registro.', 400);
  const idActividad = optPositiveInt(body.id_actividad ?? body.idActividad, 'La actividad');
  if (!idActividad) throw new OtError('Seleccione una actividad.', 400);
  return {
    idActividad,
    observacion: optStr(body.observacion, OT_LIMITS.observacion, 'La observación'),
  };
}

/** La observación es obligatoria cuando la actividad lo exige (p. ej. «Otra»). */
export function assertActividadRegistrable(
  actividad: { activo: boolean; exige_observacion: boolean; nombre: string } | null,
  observacion: string | null
): void {
  if (!actividad || !actividad.activo) {
    throw new OtError('La actividad no existe o está desactivada.', 400);
  }
  if (actividad.exige_observacion && !observacion) {
    throw new OtError(`La actividad «${actividad.nombre}» exige una observación.`, 400);
  }
}

export function parseCierre(body: Record<string, unknown> | null): { observacion: string | null } {
  return { observacion: optStr(body?.observacion, OT_LIMITS.observacionCierre, 'La observación de cierre') };
}

export interface NuevaActividadInput {
  idCompany: number;
  nombre: string;
  exigeObservacion: boolean;
  orden: number;
  icono: OtIcono | null;
}

/** Ícono opcional: clave de la lista cerrada, o null para «sin ícono». */
function parseIcono(v: unknown): OtIcono | null {
  if (v === null || v === undefined || v === '') return null;
  if (!isOtIcono(v)) throw new OtError('El ícono no es válido.', 400);
  return v;
}

function parseOrden(v: unknown): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw new OtError('El orden debe ser un número entero entre 0 y 100000.', 400);
  return n;
}

export function parseNuevaActividad(body: Record<string, unknown> | null): NuevaActividadInput {
  if (!body) throw new OtError('Se esperaba un JSON con la actividad.', 400);
  const idCompany = optPositiveInt(body.company, 'La empresa');
  if (!idCompany) throw new OtError('Falta la empresa.', 400);
  return {
    idCompany,
    nombre: reqStr(body.nombre, OT_LIMITS.actividadNombre, 'El nombre de la actividad'),
    exigeObservacion: body.exige_observacion === true,
    orden: parseOrden(body.orden),
    icono: parseIcono(body.icono),
  };
}

export interface CambioActividadInput {
  idActividad: number;
  idCompany: number;
  activo?: boolean;
  exigeObservacion?: boolean;
  orden?: number;
  icono?: OtIcono | null;
}

/** PATCH del catálogo: SOLO `activo`, `orden`, `exige_observacion` e `icono` (el nombre no cambia). */
export function parseCambioActividad(body: Record<string, unknown> | null): CambioActividadInput {
  if (!body) throw new OtError('Se esperaba un JSON con el cambio.', 400);
  const idActividad = optPositiveInt(body.id_actividad, 'La actividad');
  const idCompany = optPositiveInt(body.company, 'La empresa');
  if (!idActividad || !idCompany) throw new OtError('Falta la actividad o la empresa.', 400);
  const out: CambioActividadInput = { idActividad, idCompany };
  if (typeof body.activo === 'boolean') out.activo = body.activo;
  if (typeof body.exige_observacion === 'boolean') out.exigeObservacion = body.exige_observacion;
  if (body.orden !== undefined) out.orden = parseOrden(body.orden);
  if (body.icono !== undefined) out.icono = parseIcono(body.icono);
  if (out.activo === undefined && out.exigeObservacion === undefined && out.orden === undefined && out.icono === undefined) {
    throw new OtError('No hay cambios: solo se puede cambiar activo, orden, exige observación e ícono.', 400);
  }
  return out;
}

/** Texto seguro para un filtro OData entre comillas simples. */
export function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Filtro OData de búsqueda de OP liberadas (solo lectura). Con un número busca
 * también por DocumentNumber; con texto, por artículo, descripción y lote.
 */
export function buildSapOpFilter(q: string): string {
  const term = q.trim().slice(0, 50);
  const e = escapeOData(term);
  const parts = [`contains(ItemNo,'${e}')`, `contains(ProductDescription,'${e}')`, `U_Cod_Lote eq '${e}'`];
  if (/^\d{1,9}$/.test(term)) parts.push(`DocumentNumber eq ${Number(term)}`);
  return `ProductionOrderStatus eq 'boposReleased' and (${parts.join(' or ')})`;
}

export function isEstado(v: string): v is OtEstado {
  return v === 'ABIERTA' || v === 'CERRADA';
}
