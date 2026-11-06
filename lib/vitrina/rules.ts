/**
 * Vitrina Comercial — reglas de negocio PURAS (sin BD, sin red).
 *
 * Aquí vive todo lo que decide estados y visibilidad, para poder probarlo sin
 * SAP ni SQL Server:
 *   - fuente SAP por empresa (Farmalógica 'PT…', Ryan '301…') y el filtro OData;
 *   - estado del registro sanitario (FAR_RegiSanitario, U_Obsoleto = 'NO');
 *   - visibilidad efectiva (terceros fijos en INTERNA, canales, datos mínimos);
 *   - estructura del código de Ryan (301 + unidades + producto) y su agrupación;
 *   - lectura de la semilla CSV (sugerencias para la bandeja; NO activa nada).
 */
import {
  VITRINA_CANALES,
  VITRINA_DIAS_EXCLUSIVIDAD_POR_VENCER,
  VITRINA_DIAS_POR_VENCER,
  VITRINA_FECHA_SIN_DATO,
  VITRINA_LIMITS,
  VITRINA_VISIBILIDADES,
  vitrinaPermissionFromUrl,
  type VitrinaCanal,
  type VitrinaEstado,
  type VitrinaRegistroEstado,
  type VitrinaVisibilidad,
} from './constants';

export class VitrinaError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'VitrinaError';
  }
}

export function isVitrinaError(e: unknown): e is VitrinaError {
  return e instanceof VitrinaError;
}

// ---------------------------------------------------------------------------
// Acceso (subprocess_user_company: subproceso × empresa)
// ---------------------------------------------------------------------------

export interface VitrinaGrantRow {
  subprocessUrl: string | null | undefined;
  idCompany: number;
  companyName: string;
}

export interface VitrinaCompanyAccess {
  idCompany: number;
  companyName: string;
  /** Tiene «Vitrina Comercial» (o Gestión, que la implica) en la empresa. */
  canConsultar: boolean;
  /** Tiene «Vitrina Comercial · Gestión» en la empresa. */
  canGestionar: boolean;
}

/** Agrupa los permisos por empresa. Gestión implica consulta; una empresa sin permisos no aparece. */
export function resolveVitrinaAccess(rows: readonly VitrinaGrantRow[]): VitrinaCompanyAccess[] {
  const byCompany = new Map<number, VitrinaCompanyAccess>();
  for (const row of rows) {
    const perm = vitrinaPermissionFromUrl(row.subprocessUrl);
    if (!perm) continue;
    let entry = byCompany.get(row.idCompany);
    if (!entry) {
      entry = { idCompany: row.idCompany, companyName: row.companyName, canConsultar: false, canGestionar: false };
      byCompany.set(row.idCompany, entry);
    }
    if (perm === 'gestion') entry.canGestionar = true;
    entry.canConsultar = true;
  }
  return [...byCompany.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, 'es'));
}

/** Acceso a la empresa con el permiso pedido, o null. */
export function companyVitrinaAccess(
  access: readonly VitrinaCompanyAccess[],
  idCompany: number,
  need: 'canConsultar' | 'canGestionar'
): VitrinaCompanyAccess | null {
  const entry = access.find((a) => a.idCompany === idCompany);
  return entry && entry[need] ? entry : null;
}

// ---------------------------------------------------------------------------
// Fuente SAP por empresa (decisión de Nicolás del 22-oct: cada equipo ve SU SAP)
// ---------------------------------------------------------------------------

export interface VitrinaFuenteSap {
  idCompany: number;
  nombre: string;
  /** Prefijo del ItemCode de los artículos vendibles de la empresa. */
  prefijo: string;
  /** true = la estructura del código es la de Ryan (301 + unidades + producto). */
  codigoRyan: boolean;
}

/** Empresas del piloto. Cada una lee el endpoint de sap_endpoints de su propio id_company. */
export const VITRINA_FUENTES: Record<number, VitrinaFuenteSap> = {
  1: { idCompany: 1, nombre: 'Farmalógica', prefijo: 'PT', codigoRyan: false },
  // Ryan: producto terminado = 3 + 2 dígitos de país/línea (301 Colombia, 302 Honduras,
  // 303 El Salvador, 304…, 312 Ecuador) + 3 de unidades + 3 de producto. Verificado en SAP el 22-oct.
  2: { idCompany: 2, nombre: 'Ryan', prefijo: '3', codigoRyan: true },
};

export function fuenteDeEmpresa(idCompany: number): VitrinaFuenteSap | null {
  return VITRINA_FUENTES[idCompany] ?? null;
}

/**
 * $filter de Items para la lectura de la empresa. Se pide TODO el prefijo (sin
 * los filtros de venta) para poder detectar los artículos que se inactivan o se
 * congelan en SAP; la condición de «vendible» se evalúa con esVendible().
 */
export function filtroItemsSap(fuente: VitrinaFuenteSap): string {
  return `startswith(ItemCode,'${fuente.prefijo.replace(/'/g, "''")}')`;
}

export const ITEMS_SELECT = 'ItemCode,ItemName,ItemsGroupCode,SalesItem,Valid,Frozen';

/** Fila de ItemGroups del Service Layer (solo lectura): número y nombre del grupo de artículos. */
export interface SapGrupoRow {
  Number?: number | null;
  GroupName?: string | null;
}

/** Número → nombre del grupo de SAP (sin vacíos; nombre recortado a 100). */
export function mapaGruposSap(rows: readonly SapGrupoRow[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const r of rows) {
    const nombre = (r.GroupName ?? '').trim().slice(0, 100);
    if (typeof r.Number === 'number' && Number.isInteger(r.Number) && nombre) map.set(r.Number, nombre);
  }
  return map;
}

/** Cómo se muestra el grupo de SAP en Gestión: el nombre («PT carbapenemas»); si no hay, «Grupo 130»; null sin grupo. */
export function etiquetaGrupoSap(codigo: number | null | undefined, nombre: string | null | undefined): string | null {
  const n = (nombre ?? '').trim();
  if (n) return n;
  return codigo == null ? null : `Grupo ${codigo}`;
}

export interface SapItemRow {
  ItemCode: string;
  ItemName?: string | null;
  ItemsGroupCode?: number | null;
  SalesItem?: string | null;
  Valid?: string | null;
  Frozen?: string | null;
}

/** Artículo vendible: SalesItem tYES, Valid tYES y Frozen tNO (y con el prefijo de la empresa). */
export function esVendible(item: SapItemRow, fuente: VitrinaFuenteSap): boolean {
  return (
    typeof item.ItemCode === 'string' &&
    item.ItemCode.startsWith(fuente.prefijo) &&
    item.SalesItem === 'tYES' &&
    item.Valid === 'tYES' &&
    item.Frozen === 'tNO'
  );
}

// ---------------------------------------------------------------------------
// Registro sanitario
// ---------------------------------------------------------------------------

export interface SapRegistroRow {
  U_Referencia?: string | null;
  U_Registro_Sanitario?: string | null;
  U_Fecha_Vencimiento?: string | null;
  U_Obsoleto?: string | null;
  U_Pais?: string | null;
}

/** Fecha YYYY-MM-DD de un valor de SAP ('2026-10-19T00:00:00Z' → '2026-10-19'); null si no es fecha. */
export function fechaSap(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw).trim());
  return m ? m[1] : null;
}

/** Hoy (YYYY-MM-DD) en hora de Colombia. */
export function hoyColombia(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** Días entre dos fechas YYYY-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function esSinDato(fecha: string | null): boolean {
  return !fecha || fecha >= VITRINA_FECHA_SIN_DATO;
}

/**
 * Elige el registro que aplica a un artículo. Un artículo puede tener varios
 * registros históricos: se descartan los obsoletos (U_Obsoleto distinto de 'NO')
 * y, entre los vigentes, se prefiere el de vencimiento real más lejano; los
 * «sin fecha» (9999-01-01) solo cuentan si no hay ninguno con fecha.
 */
export function elegirRegistro(rows: readonly SapRegistroRow[]): SapRegistroRow | null {
  const activos = rows.filter((r) => (r.U_Obsoleto ?? '').trim().toUpperCase() === 'NO');
  if (activos.length === 0) return null;
  const conFecha = activos.filter((r) => !esSinDato(fechaSap(r.U_Fecha_Vencimiento)));
  const pool = conFecha.length > 0 ? conFecha : activos;
  return [...pool].sort((a, b) => (fechaSap(b.U_Fecha_Vencimiento) ?? '').localeCompare(fechaSap(a.U_Fecha_Vencimiento) ?? ''))[0];
}

export interface EstadoRegistro {
  estado: VitrinaRegistroEstado;
  numero: string | null;
  /** YYYY-MM-DD; null si no hay registro o SAP trae 9999-01-01 (sin dato). */
  venceEn: string | null;
  /** Días que faltan para el vencimiento (negativo si ya venció); null sin fecha. */
  dias: number | null;
  /** País del registro (U_Pais de SAP) con nombre normalizado; null si no viene. */
  pais?: string | null;
}

/**
 * Estado del registro sanitario:
 *   - sin registro activo            → SIN_REGISTRO (no se muestra al cliente; alerta);
 *   - 9999-01-01 o sin fecha         → SIN_FECHA («Registro sin vencimiento»: Comercial confirmó el
 *                                      23-oct que esos registros no vencen; se muestra, solo informativo);
 *   - vencimiento anterior a hoy     → VENCIDO (no se muestra al cliente; alerta);
 *   - vence en 90 días o menos       → POR_VENCER (se muestra; aviso a los administradores);
 *   - en otro caso                   → VIGENTE.
 */
export function estadoRegistro(row: SapRegistroRow | null, hoy: string, diasAviso = VITRINA_DIAS_POR_VENCER): EstadoRegistro {
  if (!row) return { estado: 'SIN_REGISTRO', numero: null, venceEn: null, dias: null, pais: null };
  const numero = (row.U_Registro_Sanitario ?? '').trim() || null;
  const pais = normalizarPais(row.U_Pais);
  const fecha = fechaSap(row.U_Fecha_Vencimiento);
  if (esSinDato(fecha)) return { estado: 'SIN_FECHA', numero, venceEn: null, dias: null, pais };
  const dias = diasEntre(hoy, fecha!);
  if (dias < 0) return { estado: 'VENCIDO', numero, venceEn: fecha, dias, pais };
  if (dias <= diasAviso) return { estado: 'POR_VENCER', numero, venceEn: fecha, dias, pais };
  return { estado: 'VIGENTE', numero, venceEn: fecha, dias, pais };
}

const PAISES_CONOCIDOS: Record<string, string> = {
  COLOMBIA: 'Colombia', ECUADOR: 'Ecuador', PERU: 'Perú', BOLIVIA: 'Bolivia', CHILE: 'Chile',
  GUATEMALA: 'Guatemala', 'EL SALVADOR': 'El Salvador', SALVADOR: 'El Salvador', HONDURAS: 'Honduras',
  NICARAGUA: 'Nicaragua', 'COSTA RICA': 'Costa Rica', PANAMA: 'Panamá', MEXICO: 'México',
  VENEZUELA: 'Venezuela', 'REPUBLICA DOMINICANA': 'República Dominicana', PARAGUAY: 'Paraguay', URUGUAY: 'Uruguay', ARGENTINA: 'Argentina',
};

/** «COLOMBIA» → «Colombia», «PERU» → «Perú». Lo desconocido se devuelve con mayúscula inicial. */
export function normalizarPais(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const clave = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
  if (PAISES_CONOCIDOS[clave]) return PAISES_CONOCIDOS[clave];
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Agrupa los registros por U_Referencia (= ItemCode). */
export function registrosPorCodigo(rows: readonly SapRegistroRow[]): Map<string, SapRegistroRow[]> {
  const map = new Map<string, SapRegistroRow[]>();
  for (const r of rows) {
    const ref = (r.U_Referencia ?? '').trim();
    if (!ref) continue;
    const list = map.get(ref);
    if (list) list.push(r);
    else map.set(ref, [r]);
  }
  return map;
}

/** El registro impide mostrar el producto al cliente. */
export function registroBloqueaCliente(estado: string): boolean {
  return estado === 'VENCIDO' || estado === 'SIN_REGISTRO';
}

// ---------------------------------------------------------------------------
// Visibilidad
// ---------------------------------------------------------------------------

const NIVEL: Record<VitrinaVisibilidad, number> = { INTERNA: 0, CLIENTE: 1, OFERTABLE: 2 };

export function esVisibilidad(v: unknown): v is VitrinaVisibilidad {
  return typeof v === 'string' && (VITRINA_VISIBILIDADES as readonly string[]).includes(v);
}

export function esCanal(v: unknown): v is VitrinaCanal {
  return typeof v === 'string' && (VITRINA_CANALES as readonly string[]).includes(v);
}

function menor(a: VitrinaVisibilidad, b: VitrinaVisibilidad): VitrinaVisibilidad {
  return NIVEL[a] <= NIVEL[b] ? a : b;
}

/**
 * Regla de terceros: un producto fabricado para terceros (PISA, Bioselect…) tiene
 * visibilidad FIJA «INTERNA». Lanza 400 si se intenta otra; devuelve la visibilidad
 * final que se debe guardar.
 */
export function visibilidadPermitida(visibilidad: unknown, esParaTerceros: boolean): VitrinaVisibilidad {
  if (!esVisibilidad(visibilidad)) throw new VitrinaError('Visibilidad no válida: use Interna, Vista al cliente u Ofertable.', 400);
  if (esParaTerceros && visibilidad !== 'INTERNA') {
    throw new VitrinaError('Los productos fabricados para terceros tienen visibilidad fija «Interna»: no se pueden mostrar al cliente ni ofertar.', 400);
  }
  return visibilidad;
}

export interface PresentacionDatos {
  molecula?: string | null;
  concentracion?: string | null;
  forma_farmaceutica?: string | null;
  familia?: string | null;
}

/** Datos mínimos que debe tener una presentación para mostrarse al cliente. */
export function datosFaltantes(p: PresentacionDatos): string[] {
  const faltan: string[] = [];
  if (!p.molecula?.trim()) faltan.push('molécula');
  if (!p.concentracion?.trim()) faltan.push('concentración');
  if (!p.forma_farmaceutica?.trim()) faltan.push('forma farmacéutica');
  if (!p.familia?.trim()) faltan.push('familia');
  return faltan;
}

export interface VisibilidadInput {
  presentacion: PresentacionDatos & { estado: string; visibilidad: string; es_para_terceros: boolean };
  codigo: { canal: string; visibilidad_canal: string; activado_vitrina: boolean; activo_en_sap: boolean; registro_estado: string };
}

export type VisibilidadEfectiva = VitrinaVisibilidad | 'OCULTA';

/**
 * Cómo se vería UN código SAP de una presentación en la Vitrina:
 *   - OCULTA si no está activado a mano, si SAP lo inactivó o congeló, o si la
 *     presentación está RETIRADA (nada se muestra sin activación manual);
 *   - parte de la visibilidad de la presentación (INTERNA fija si es para terceros);
 *   - si el código tiene canal (institucional/comercial), no supera la visibilidad
 *     configurada para ese canal (que empieza en INTERNA);
 *   - pendiente de validar, registro vencido o sin registro, o datos faltantes → como máximo INTERNA.
 */
export function visibilidadEfectiva({ presentacion: p, codigo: c }: VisibilidadInput): VisibilidadEfectiva {
  if (!c.activado_vitrina || !c.activo_en_sap || p.estado === 'RETIRADA') return 'OCULTA';
  let v: VitrinaVisibilidad = p.es_para_terceros ? 'INTERNA' : esVisibilidad(p.visibilidad) ? p.visibilidad : 'INTERNA';
  if (c.canal === 'INSTITUCIONAL' || c.canal === 'COMERCIAL') v = menor(v, esVisibilidad(c.visibilidad_canal) ? c.visibilidad_canal : 'INTERNA');
  if (p.estado !== 'VALIDADA' || registroBloqueaCliente(c.registro_estado) || datosFaltantes(p).length > 0) v = 'INTERNA';
  return v;
}

/** Motivos legibles por los que un código no llega al cliente (para la Gestión). */
export function motivosNoCliente({ presentacion: p, codigo: c }: VisibilidadInput): string[] {
  const m: string[] = [];
  if (!c.activado_vitrina) m.push('No está activado en la Vitrina');
  if (!c.activo_en_sap) m.push('Inactivo o congelado en SAP');
  if (p.estado === 'RETIRADA') m.push('Presentación retirada');
  if (p.estado === 'PENDIENTE') m.push('Presentación pendiente de validar');
  if (p.es_para_terceros) m.push('Producto para terceros (siempre interno)');
  else if (p.visibilidad === 'INTERNA') m.push('Visibilidad interna');
  if ((c.canal === 'INSTITUCIONAL' || c.canal === 'COMERCIAL') && c.visibilidad_canal === 'INTERNA') m.push(`Canal ${c.canal === 'INSTITUCIONAL' ? 'institucional' : 'comercial'} en interna`);
  if (c.registro_estado === 'VENCIDO') m.push('Registro sanitario vencido');
  if (c.registro_estado === 'SIN_REGISTRO') m.push('Sin registro sanitario');
  const faltan = datosFaltantes(p);
  if (faltan.length) m.push(`Faltan datos: ${faltan.join(', ')}`);
  return m;
}

/** Transición de estado de la presentación (acción del historial). */
export function accionDeEstado(estado: VitrinaEstado): 'VALIDAR' | 'RETIRAR' | 'EDITAR' {
  return estado === 'VALIDADA' ? 'VALIDAR' : estado === 'RETIRADA' ? 'RETIRAR' : 'EDITAR';
}

// ---------------------------------------------------------------------------
// Exclusividades
// ---------------------------------------------------------------------------

export type EstadoExclusividad = 'VIGENTE' | 'POR_VENCER' | 'VENCIDA' | 'FUTURA';

export function estadoExclusividad(desde: string | null, hasta: string | null, hoy: string): EstadoExclusividad {
  if (desde && desde > hoy) return 'FUTURA';
  if (hasta) {
    const d = diasEntre(hoy, hasta);
    if (d < 0) return 'VENCIDA';
    if (d <= VITRINA_DIAS_EXCLUSIVIDAD_POR_VENCER) return 'POR_VENCER';
  }
  return 'VIGENTE';
}

/** Valida la vigencia (YYYY-MM-DD o vacía) y que «desde» no sea posterior a «hasta». */
export function validarVigencia(desde: unknown, hasta: unknown): { desde: string | null; hasta: string | null } {
  const norm = (v: unknown, campo: string): string | null => {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new VitrinaError(`La fecha «${campo}» no es válida.`, 400);
    return s;
  };
  const d = norm(desde, 'vigente desde');
  const h = norm(hasta, 'vigente hasta');
  if (d && h && d > h) throw new VitrinaError('La vigencia «desde» no puede ser posterior a «hasta».', 400);
  return { desde: d, hasta: h };
}

// ---------------------------------------------------------------------------
// Código de Ryan: 3 + 2 dígitos de país/línea (301 Colombia…312 Ecuador) + 3 de unidades + 3 de producto
// ---------------------------------------------------------------------------

export interface CodigoRyan {
  pais: string;
  /** Unidades por caja según el código (001 = unidad, 010 = x10…); null si no son dígitos. */
  unidades: number | null;
  /** Clave del producto (3 últimos dígitos): las presentaciones de un producto la comparten. */
  producto: string;
  /** Texto que sobra después de los 9 dígitos (sufijos «-LP», «.»…). */
  sufijo: string;
  /** El código no sigue la estructura exacta de 9 dígitos: revisar antes de agrupar. */
  excepcion: boolean;
}

export function parseCodigoRyan(itemCode: string): CodigoRyan | null {
  const m = /^(3\d{2})(\d{3})(\d{3})(.*)$/.exec((itemCode ?? '').trim());
  if (!m) return null;
  const unidades = Number(m[2]);
  return { pais: m[1], unidades: unidades > 0 && unidades < 999 ? unidades : null, producto: m[3], sufijo: m[4], excepcion: m[4] !== '' || unidades === 0 || unidades === 999 };
}

export interface GrupoRyan<T> {
  producto: string;
  codigos: T[];
  /** Avisos del grupo (sufijos, unidades repetidas). No se agrupa automáticamente. */
  avisos: string[];
}

/**
 * Sugerencia de agrupación de Ryan por los 3 últimos dígitos. Es SOLO una
 * sugerencia: el administrador confirma. Marca las excepciones (sufijos y dos
 * códigos con las mismas unidades, p. ej. un producto duplicado por país).
 */
export function agruparPorProductoRyan<T extends { item_code: string }>(codigos: readonly T[]): GrupoRyan<T>[] {
  const grupos = new Map<string, GrupoRyan<T>>();
  for (const c of codigos) {
    const p = parseCodigoRyan(c.item_code);
    if (!p) continue;
    let g = grupos.get(p.producto);
    if (!g) {
      g = { producto: p.producto, codigos: [], avisos: [] };
      grupos.set(p.producto, g);
    }
    g.codigos.push(c);
    if (p.sufijo) g.avisos.push(`${c.item_code}: sufijo «${p.sufijo}», revisar en SAP`);
    if (p.unidades === null) g.avisos.push(`${c.item_code}: unidades sin dato en el código`);
  }
  for (const g of grupos.values()) {
    const vistos = new Map<string, string>();
    for (const c of g.codigos) {
      const p = parseCodigoRyan(c.item_code)!;
      if (p.unidades === null || p.sufijo) continue;
      const clave = `${p.pais}-${p.unidades}`;
      const previo = vistos.get(clave);
      if (previo) g.avisos.push(`${previo} y ${c.item_code} tienen el mismo prefijo y las mismas unidades: posible duplicado`);
      else vistos.set(clave, c.item_code);
    }
  }
  return [...grupos.values()].sort((a, b) => a.producto.localeCompare(b.producto));
}

// ---------------------------------------------------------------------------
// Sugerencias al leer SAP (el administrador confirma)
// ---------------------------------------------------------------------------

/** Familia sugerida por ItemsGroupCode de Farmalógica. Ryan y PTRY se asignan a mano. */
const FAMILIA_POR_GRUPO_FARMALOGICA: Record<number, string> = {
  130: 'Carbapenémicos',
  133: 'Cefalosporinas',
  137: 'Monobactámicos',
  139: 'Penicilinas',
};

export function familiaSugerida(fuente: VitrinaFuenteSap, itemsGroupCode: number | null | undefined): string | null {
  if (fuente.codigoRyan || itemsGroupCode == null) return null;
  return FAMILIA_POR_GRUPO_FARMALOGICA[itemsGroupCode] ?? null;
}

/** Canal sugerido: «INST» al final del código o «institucional» en el nombre. El resto, sin dato. */
export function canalSugerido(itemCode: string, itemName: string | null | undefined): VitrinaCanal {
  if (/INST$/i.test(itemCode.trim()) || /institucional/i.test(itemName ?? '')) return 'INSTITUCIONAL';
  return 'SIN_DATO';
}

/** Unidades por caja sugeridas: del código de Ryan o del «x10» del nombre. */
export function unidadesSugeridas(fuente: VitrinaFuenteSap, itemCode: string, nombre: string | null | undefined): number | null {
  if (fuente.codigoRyan) return parseCodigoRyan(itemCode)?.unidades ?? null;
  const m = /\bx\s?(\d{1,4})\b/i.exec(nombre ?? '');
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Semilla CSV (separador «;»). Llena SUGERENCIAS en la bandeja: no activa nada.
// ---------------------------------------------------------------------------

export interface SemillaFila {
  itemCode: string;
  itemName: string | null;
  presentacion: string | null;
  familia: string | null;
  pais: string | null;
  tipo: string | null;
  observacion: string | null;
  esParaTerceros: boolean;
  clienteMarca: string | null;
  unidades: number | null;
}

export interface SemillaResultado {
  formato: 'FARMALOGICA' | 'RYAN';
  filas: SemillaFila[];
  errores: string[];
}

function limpio(v: string | undefined, max: number): string | null {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

/** «Para terceros (PISA, el codigo no lleva P)» → PISA; «Marca por pais (CORVAL)» → CORVAL. */
export function marcaDeTipo(tipo: string | null): string | null {
  const m = /\(([^,)]+)/.exec(tipo ?? '');
  if (!m) return null;
  const marca = m[1].trim();
  return /^(INST|codigo|sin )/i.test(marca) ? null : marca.slice(0, VITRINA_LIMITS.clienteMarca);
}

export function tipoEsTerceros(tipo: string | null): boolean {
  return /^para terceros/i.test((tipo ?? '').trim());
}

const FAMILIAS_NORMALIZADAS: Record<string, string> = {
  carbapenemas: 'Carbapenémicos',
  cefalosporinas: 'Cefalosporinas',
  monobactamicos: 'Monobactámicos',
  penicilinas: 'Penicilinas',
  vitaminas: 'Vitaminas',
};

/** «Cefalosporinas (en SAP: Articulos)» → Cefalosporinas; «Por asignar» → null. */
export function familiaDeSemilla(raw: string | null): string | null {
  const base = (raw ?? '').replace(/\(.*\)/, '').trim();
  if (!base || /^por asignar/i.test(base)) return null;
  const key = base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return FAMILIAS_NORMALIZADAS[key] ?? base.slice(0, VITRINA_LIMITS.familia);
}

/**
 * Lee la semilla. Detecta el formato por el encabezado:
 *   Farmalógica: Codigo SAP;Presentacion propuesta;Empresa;Familia (grupo SAP);Pais;Tipo;Visibilidad propuesta
 *   Ryan:        Codigo SAP Ryan;Nombre en SAP;Unidades (segun codigo);Producto (3 ultimos digitos);Pais;Observacion
 * La última columna puede traer «;» (se une el resto).
 */
export function parseSemilla(texto: string): SemillaResultado {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lineas.length === 0) throw new VitrinaError('El archivo está vacío.', 400);
  if (lineas.length - 1 > VITRINA_LIMITS.semillaFilas) throw new VitrinaError(`El archivo supera ${VITRINA_LIMITS.semillaFilas} filas.`, 400);
  const head = lineas[0].toLowerCase();
  const formato: SemillaResultado['formato'] | null = head.startsWith('codigo sap ryan')
    ? 'RYAN'
    : head.startsWith('codigo sap;presentacion propuesta')
      ? 'FARMALOGICA'
      : null;
  if (!formato) throw new VitrinaError('Encabezado no reconocido: use la carga inicial de Farmalógica o la de Ryan (separador «;»).', 400);

  const filas: SemillaFila[] = [];
  const errores: string[] = [];
  const vistos = new Set<string>();
  lineas.slice(1).forEach((linea, i) => {
    const n = i + 2;
    const cols = linea.split(';');
    const itemCode = (cols[0] ?? '').trim();
    if (!itemCode || itemCode.length > 50) {
      errores.push(`Fila ${n}: código SAP vacío o demasiado largo.`);
      return;
    }
    if (vistos.has(itemCode)) {
      errores.push(`Fila ${n}: el código ${itemCode} está repetido; se toma la primera fila.`);
      return;
    }
    vistos.add(itemCode);
    if (formato === 'FARMALOGICA') {
      if (cols.length < 7) {
        errores.push(`Fila ${n}: faltan columnas.`);
        return;
      }
      const tipo = limpio(cols[5], 100);
      filas.push({
        itemCode,
        itemName: null,
        presentacion: limpio(cols[1], VITRINA_LIMITS.molecula),
        familia: familiaDeSemilla(limpio(cols[3], 200)),
        pais: limpio(cols[4], VITRINA_LIMITS.pais),
        tipo,
        observacion: limpio([cols[2], cols.slice(6).join(';')].filter((x) => x && x.trim()).join(' · '), 300),
        esParaTerceros: tipoEsTerceros(tipo),
        clienteMarca: marcaDeTipo(tipo),
        unidades: null,
      });
    } else {
      if (cols.length < 6) {
        errores.push(`Fila ${n}: faltan columnas.`);
        return;
      }
      const unidades = Number((cols[2] ?? '').trim());
      filas.push({
        itemCode,
        itemName: limpio(cols[1], 200),
        presentacion: null,
        familia: null,
        pais: limpio(cols[4], VITRINA_LIMITS.pais),
        tipo: 'Ryan',
        observacion: limpio(cols.slice(5).join(';'), 300),
        esParaTerceros: false,
        clienteMarca: null,
        unidades: Number.isInteger(unidades) && unidades > 0 && unidades < 999 ? unidades : null,
      });
    }
  });
  return { formato, filas, errores };
}

/** La semilla corresponde a la empresa (Farmalógica = 1, Ryan = 2). */
export function semillaDeEmpresa(formato: SemillaResultado['formato'], idCompany: number): boolean {
  return (formato === 'FARMALOGICA' && idCompany === 1) || (formato === 'RYAN' && idCompany === 2);
}

// ---------------------------------------------------------------------------
// Validación de entradas
// ---------------------------------------------------------------------------

/** Texto opcional recortado; lanza 400 si supera el máximo. */
export function textoOpcional(v: unknown, max: number, campo: string): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new VitrinaError(`«${campo}» supera ${max} caracteres.`, 400);
  return s;
}

export function textoObligatorio(v: unknown, max: number, campo: string): string {
  const s = textoOpcional(v, max, campo);
  if (!s) throw new VitrinaError(`Falta «${campo}».`, 400);
  return s;
}

export function enteroOpcional(v: unknown, campo: string, min = 1, max = 100_000): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new VitrinaError(`«${campo}» debe ser un número entero entre ${min} y ${max}.`, 400);
  return n;
}

/** Canal que sugiere la semilla: «INST» al final, «canal institucional/comercial» en el tipo, o México con «C» final. */
export function canalDeSemilla(fila: Pick<SemillaFila, 'itemCode' | 'itemName' | 'tipo' | 'observacion' | 'pais'>): VitrinaCanal {
  const texto = `${fila.tipo ?? ''} ${fila.observacion ?? ''}`;
  if (canalSugerido(fila.itemCode, fila.itemName) === 'INSTITUCIONAL' || /canal institucional/i.test(texto)) return 'INSTITUCIONAL';
  if (/canal comercial/i.test(texto)) return 'COMERCIAL';
  if (/m[eé]xico/i.test(`${fila.pais ?? ''} ${fila.tipo ?? ''}`) && /\dC$/.test(fila.itemCode)) return 'COMERCIAL';
  return 'SIN_DATO';
}

const DOSIS = /\d[\d.,]{0,8} ?(?:mg|g|mcg|µg|UI|mEq|%|mL)\b/i;
const UNION = /^ ?[/+] ?/;

/** «4,5 g», «1 mg/mL», «500 mg + 62,5 mg»: dosis seguidas unidas por «/» o «+». */
function concentracionDe(base: string): { index: number; texto: string } | null {
  const m = DOSIS.exec(base);
  if (!m) return null;
  let texto = m[0];
  let resto = base.slice(m.index + m[0].length);
  for (let i = 0; i < 3; i++) {
    const u = UNION.exec(resto);
    if (!u) break;
    const tras = resto.slice(u[0].length);
    const d = /^\d[\d.,]{0,8} ?(?:mg|g|mcg|UI|mEq|mL)\b/i.exec(tras) ?? /^(?:mg|g|mcg|UI|mEq|mL)\b/i.exec(tras);
    if (!d) break;
    texto += `${u[0].trim()}${d[0]}`;
    resto = tras.slice(d[0].length);
  }
  return { index: m.index, texto: texto.replace(/\s+/g, ' ').trim() };
}

export interface PresentacionSugerida {
  molecula: string;
  concentracion: string | null;
  unidades: number | null;
  nombreComercial: string | null;
}

/**
 * Prellenado del formulario a partir de la presentación sugerida o del nombre de SAP:
 * «Aztreonam 1 g x10 - AZBIOS» → Aztreonam · 1 g · 10 · AZBIOS. Solo orienta: el
 * administrador corrige antes de guardar.
 */
export function parsePresentacionSugerida(texto: string | null | undefined): PresentacionSugerida | null {
  const t = (texto ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const [base, ...marca] = t.split(/\s+-\s+/);
  const nombreComercial = marca.join(' - ').trim() || null;
  const unidadesM = /\bx\s?(\d{1,4})\b/i.exec(base);
  const conc = concentracionDe(base);
  let molecula = base;
  if (conc) molecula = base.slice(0, conc.index);
  else if (unidadesM) molecula = base.slice(0, unidadesM.index);
  molecula = molecula.replace(/[\s,(-]+$/, '').trim() || base;
  return {
    molecula: molecula.slice(0, VITRINA_LIMITS.molecula),
    concentracion: conc ? conc.texto.slice(0, VITRINA_LIMITS.concentracion) : null,
    unidades: unidadesM ? Number(unidadesM[1]) : null,
    nombreComercial: nombreComercial ? nombreComercial.slice(0, VITRINA_LIMITS.nombreComercial) : null,
  };
}
