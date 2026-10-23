/**
 * Vitrina Comercial — catálogo de los COMERCIALES (sprint V3/V4). Archivo PURO.
 *
 * Arma lo que ve un comercial a partir de las filas de la base, reutilizando las
 * reglas de visibilidad de rules.ts (no las duplica):
 *   - vista interna: presentaciones VALIDADAS con al menos un código activado y
 *     activo en SAP; muestra INTERNA, CLIENTE y OFERTABLE de la empresa;
 *   - modo presentación: solo códigos CLIENTE u OFERTABLE con registro VIGENTE,
 *     POR_VENCER o SIN_FECHA (nunca VENCIDO ni SIN_REGISTRO); los productos para
 *     terceros nunca salen; se quitan los códigos SAP, las exclusividades, las
 *     alertas y los estados internos.
 * También: filtros combinables, agrupación por familia, conteo por país y la
 * navegación del modo presentación. Sin stock ni precios (fase 1).
 */
import {
  VITRINA_MAX_DESTACADAS,
  type VitrinaCanal,
  type VitrinaImagenTipo,
  type VitrinaVisibilidad,
} from './constants';
import { esCanal, estadoExclusividad, fuenteDeEmpresa, visibilidadEfectiva, type EstadoExclusividad } from './rules';

export type VitrinaModo = 'interna' | 'presentacion';

/** Estados del registro con los que un código puede salir en el modo presentación. */
export const REGISTROS_PRESENTABLES = ['VIGENTE', 'POR_VENCER', 'SIN_FECHA'] as const;

// ---------------------------------------------------------------------------
// Entrada (filas de Prisma, sin depender del cliente generado)
// ---------------------------------------------------------------------------

export interface CatalogoFilaCodigo {
  item_code: string;
  pais: string | null;
  canal: string;
  visibilidad_canal: string;
  activado_vitrina: boolean;
  activo_en_sap: boolean;
  registro_estado: string;
  registro_sanitario: string | null;
  registro_vence_en: Date | null;
}

export interface CatalogoFila {
  id_presentacion: number;
  molecula: string;
  concentracion: string | null;
  forma_farmaceutica: string | null;
  unidades_caja: number | null;
  nombre_comercial: string | null;
  tall_man: string | null;
  familia: string | null;
  estado: string;
  visibilidad: string;
  es_para_terceros: boolean;
  destacada: boolean;
  codigos: CatalogoFilaCodigo[];
  areas: { area: { nombre: string; activa: boolean; orden: number } }[];
  imagenes: { id_imagen: number; tipo: string; vigente: boolean }[];
  exclusividades: {
    cliente_beneficiario: string;
    pais: string | null;
    canal: string | null;
    alcance: string;
    vigente_desde: Date | null;
    vigente_hasta: Date | null;
  }[];
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export interface CatalogoCodigo {
  /** null en el modo presentación (los códigos SAP no se muestran al cliente). */
  itemCode: string | null;
  pais: string | null;
  canal: VitrinaCanal;
  visibilidad: VitrinaVisibilidad;
  registroSanitario: string | null;
  /** null en el modo presentación (el estado es un dato interno). */
  registroEstado: string | null;
  registroVenceEn: string | null;
}

export interface CatalogoExclusividad {
  clienteBeneficiario: string;
  pais: string | null;
  canal: string | null;
  alcance: string;
  vigenteHasta: string | null;
  estado: EstadoExclusividad;
}

export type CatalogoImagenes = Record<VitrinaImagenTipo, number | null>;

export interface CatalogoItem {
  id: number;
  molecula: string;
  concentracion: string | null;
  formaFarmaceutica: string | null;
  unidadesCaja: number | null;
  nombreComercial: string | null;
  tallMan: string | null;
  familia: string | null;
  destacada: boolean;
  esParaTerceros: boolean;
  /** La mayor visibilidad entre sus códigos visibles. */
  visibilidad: VitrinaVisibilidad;
  areas: string[];
  paises: string[];
  canales: VitrinaCanal[];
  codigos: CatalogoCodigo[];
  imagenes: CatalogoImagenes;
  /** Vacío en el modo presentación. */
  exclusividades: CatalogoExclusividad[];
}

const NIVEL: Record<VitrinaVisibilidad, number> = { INTERNA: 0, CLIENTE: 1, OFERTABLE: 2 };
const fechaIso = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const compara = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });

/**
 * Visibilidad con la que UN código sale en el modo pedido, o null si no sale.
 * Parte de visibilidadEfectiva() (rules.ts) y le suma las reglas del comercial.
 */
export function visibilidadEnModo(modo: VitrinaModo, presentacion: CatalogoFila, codigo: CatalogoFilaCodigo): VitrinaVisibilidad | null {
  if (presentacion.estado !== 'VALIDADA') return null;
  const v = visibilidadEfectiva({ presentacion, codigo });
  if (v === 'OCULTA') return null;
  if (modo === 'interna') return v;
  if (presentacion.es_para_terceros) return null;
  if (v !== 'CLIENTE' && v !== 'OFERTABLE') return null;
  if (!(REGISTROS_PRESENTABLES as readonly string[]).includes(codigo.registro_estado)) return null;
  return v;
}

function unicos(valores: (string | null | undefined)[]): string[] {
  return [...new Set(valores.map((v) => (v ?? '').trim()).filter(Boolean))].sort(compara);
}

/** Imagen vigente más reciente por tipo (id mayor = carga más reciente). */
export function imagenesVigentes(imagenes: CatalogoFila['imagenes']): CatalogoImagenes {
  const out: CatalogoImagenes = { VIAL: null, ETIQUETA: null, PLEGADIZA: null };
  for (const img of imagenes) {
    if (!img.vigente || !(img.tipo in out)) continue;
    const t = img.tipo as VitrinaImagenTipo;
    if (out[t] === null || img.id_imagen > (out[t] as number)) out[t] = img.id_imagen;
  }
  return out;
}

/** Una presentación tal como la ve el comercial en el modo pedido, o null si no se muestra. */
export function itemDeCatalogo(fila: CatalogoFila, modo: VitrinaModo, hoy: string): CatalogoItem | null {
  const codigos: CatalogoCodigo[] = [];
  for (const c of [...fila.codigos].sort((a, b) => compara(a.item_code, b.item_code))) {
    const v = visibilidadEnModo(modo, fila, c);
    if (!v) continue;
    codigos.push({
      itemCode: modo === 'interna' ? c.item_code : null,
      pais: c.pais?.trim() || null,
      canal: esCanal(c.canal) ? c.canal : 'SIN_DATO',
      visibilidad: v,
      registroSanitario: c.registro_sanitario?.trim() || null,
      registroEstado: modo === 'interna' ? c.registro_estado : null,
      registroVenceEn: fechaIso(c.registro_vence_en),
    });
  }
  if (codigos.length === 0) return null;
  const visibilidad = codigos.reduce<VitrinaVisibilidad>((m, c) => (NIVEL[c.visibilidad] > NIVEL[m] ? c.visibilidad : m), 'INTERNA');
  const exclusividades: CatalogoExclusividad[] =
    modo === 'interna'
      ? fila.exclusividades
          .map((e) => ({
            clienteBeneficiario: e.cliente_beneficiario,
            pais: e.pais,
            canal: e.canal,
            alcance: e.alcance,
            vigenteHasta: fechaIso(e.vigente_hasta),
            estado: estadoExclusividad(fechaIso(e.vigente_desde), fechaIso(e.vigente_hasta), hoy),
          }))
          .filter((e) => e.estado !== 'VENCIDA')
      : [];
  const areas = [...fila.areas]
    .filter((a) => a.area.activa)
    .sort((a, b) => a.area.orden - b.area.orden || compara(a.area.nombre, b.area.nombre))
    .map((a) => a.area.nombre);
  return {
    id: fila.id_presentacion,
    molecula: fila.molecula,
    concentracion: fila.concentracion,
    formaFarmaceutica: fila.forma_farmaceutica,
    unidadesCaja: fila.unidades_caja,
    nombreComercial: fila.nombre_comercial,
    tallMan: fila.tall_man,
    familia: fila.familia,
    destacada: fila.destacada,
    esParaTerceros: modo === 'interna' ? fila.es_para_terceros : false,
    visibilidad,
    areas,
    paises: unicos(codigos.map((c) => c.pais)),
    canales: [...new Set(codigos.map((c) => c.canal))].filter((c) => c !== 'SIN_DATO').sort(compara) as VitrinaCanal[],
    codigos,
    imagenes: imagenesVigentes(fila.imagenes),
    exclusividades,
  };
}

/** Orden de la biblioteca: familia, molécula, concentración y unidades por caja. */
export function ordenarCatalogo(items: readonly CatalogoItem[]): CatalogoItem[] {
  return [...items].sort(
    (a, b) =>
      (a.familia?.trim() ? 0 : 1) - (b.familia?.trim() ? 0 : 1) ||
      compara(a.familia ?? '', b.familia ?? '') ||
      compara(a.molecula, b.molecula) ||
      compara(a.concentracion ?? '', b.concentracion ?? '') ||
      (a.unidadesCaja ?? 0) - (b.unidadesCaja ?? 0) ||
      a.id - b.id
  );
}

export function armarCatalogo(filas: readonly CatalogoFila[], modo: VitrinaModo, hoy: string): CatalogoItem[] {
  return ordenarCatalogo(filas.map((f) => itemDeCatalogo(f, modo, hoy)).filter((x): x is CatalogoItem => x !== null));
}

// ---------------------------------------------------------------------------
// Filtros (combinables) y facetas
// ---------------------------------------------------------------------------

export interface CatalogoFiltros {
  q?: string | null;
  pais?: string | null;
  canal?: string | null;
  area?: string | null;
  forma?: string | null;
}

export const FILTROS_CLAVES = ['q', 'pais', 'canal', 'area', 'forma'] as const;

/** Minúsculas y sin tildes, para buscar «cefalosporinas» con «Cefalosporínas» o «CEFALO». */
export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function textoDeBusqueda(p: CatalogoItem): string {
  return normalizarTexto(
    [p.molecula, p.concentracion, p.formaFarmaceutica, p.nombreComercial, p.tallMan, p.familia, p.unidadesCaja ? `x${p.unidadesCaja}` : null, ...p.areas, ...p.codigos.map((c) => c.itemCode)]
      .filter(Boolean)
      .join(' ')
  );
}

/**
 * Filtros combinables (todos con Y). País y canal se evalúan sobre el MISMO código:
 * «Perú + institucional» exige un código de Perú del canal institucional.
 * El texto busca cada palabra por separado.
 */
export function filtrarCatalogo(items: readonly CatalogoItem[], f: CatalogoFiltros): CatalogoItem[] {
  const palabras = normalizarTexto(f.q).split(/\s+/).filter(Boolean);
  const pais = f.pais?.trim() || null;
  const canal = f.canal?.trim() || null;
  const area = f.area?.trim() || null;
  const forma = f.forma?.trim() || null;
  return items.filter((p) => {
    if (area && !p.areas.includes(area)) return false;
    if (forma && normalizarTexto(p.formaFarmaceutica) !== normalizarTexto(forma)) return false;
    if ((pais || canal) && !p.codigos.some((c) => (!pais || c.pais === pais) && (!canal || c.canal === canal))) return false;
    if (palabras.length) {
      const t = textoDeBusqueda(p);
      if (!palabras.every((w) => t.includes(w))) return false;
    }
    return true;
  });
}

export function hayFiltros(f: CatalogoFiltros): boolean {
  return FILTROS_CLAVES.some((k) => Boolean(f[k]?.trim()));
}

export interface CatalogoFacetas {
  paises: string[];
  canales: VitrinaCanal[];
  areas: string[];
  formas: string[];
}

export function facetasCatalogo(items: readonly CatalogoItem[]): CatalogoFacetas {
  return {
    paises: unicos(items.flatMap((p) => p.paises)),
    canales: [...new Set(items.flatMap((p) => p.canales))].sort(compara) as VitrinaCanal[],
    areas: unicos(items.flatMap((p) => p.areas)),
    formas: unicos(items.map((p) => p.formaFarmaceutica)),
  };
}

/** Filtros desde la URL (?pais=Perú&canal=INSTITUCIONAL…). Valores desconocidos de canal se ignoran. */
export function filtrosDesdeParams(params: URLSearchParams | { get(k: string): string | null }): CatalogoFiltros {
  const out: CatalogoFiltros = {};
  for (const k of FILTROS_CLAVES) {
    const v = params.get(k)?.trim();
    if (!v) continue;
    if (k === 'canal' && !esCanal(v)) continue;
    out[k] = v.slice(0, 120);
  }
  return out;
}

/** Parámetros de URL de unos filtros (sin vacíos). */
export function paramsDesdeFiltros(f: CatalogoFiltros): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of FILTROS_CLAVES) {
    const v = f[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agrupaciones
// ---------------------------------------------------------------------------

export const SIN_FAMILIA = 'Sin familia';

export interface GrupoFamilia {
  familia: string;
  items: CatalogoItem[];
}

/** Estanterías de la biblioteca: una por familia, en orden alfabético; «Sin familia» al final. */
export function agruparPorFamilia(items: readonly CatalogoItem[]): GrupoFamilia[] {
  const map = new Map<string, CatalogoItem[]>();
  for (const p of items) {
    const f = p.familia?.trim() || SIN_FAMILIA;
    const list = map.get(f);
    if (list) list.push(p);
    else map.set(f, [p]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === SIN_FAMILIA ? 1 : b === SIN_FAMILIA ? -1 : compara(a, b)))
    .map(([familia, list]) => ({ familia, items: ordenarCatalogo(list) }));
}

export interface PaisConteo {
  pais: string;
  presentaciones: number;
}

/**
 * Presencia LATAM: cada país con el número de presentaciones que tienen al menos un
 * código visible allí. Los códigos sin país no cuentan (el administrador lo completa).
 */
export function presentacionesPorPais(items: readonly CatalogoItem[]): PaisConteo[] {
  const map = new Map<string, number>();
  for (const p of items) for (const pais of p.paises) map.set(pais, (map.get(pais) ?? 0) + 1);
  return [...map.entries()].map(([pais, presentaciones]) => ({ pais, presentaciones })).sort((a, b) => compara(a.pais, b.pais));
}

/** Hasta 3 destacadas para el Inicio (en el orden de la biblioteca). */
export function destacadasDe(items: readonly CatalogoItem[], max = VITRINA_MAX_DESTACADAS): CatalogoItem[] {
  return items.filter((p) => p.destacada).slice(0, max);
}

/** Registros sanitarios de la presentación, sin repetir (institucional y comercial comparten registro). */
export function registrosDe(item: CatalogoItem): { numero: string | null; venceEn: string | null; estado: string | null; paises: string[] }[] {
  const map = new Map<string, { numero: string | null; venceEn: string | null; estado: string | null; paises: Set<string> }>();
  for (const c of item.codigos) {
    const clave = c.registroSanitario ?? `__sin__${c.registroEstado ?? ''}`;
    let r = map.get(clave);
    if (!r) {
      r = { numero: c.registroSanitario, venceEn: c.registroVenceEn, estado: c.registroEstado, paises: new Set() };
      map.set(clave, r);
    }
    if (c.pais) r.paises.add(c.pais);
  }
  return [...map.values()].map((r) => ({ ...r, paises: [...r.paises].sort(compara) }));
}

// ---------------------------------------------------------------------------
// Presentación en pantalla
// ---------------------------------------------------------------------------

/** «Meropenem 1 g x10». */
export function tituloPresentacion(p: Pick<CatalogoItem, 'molecula' | 'concentracion' | 'unidadesCaja'>): string {
  return [p.molecula, p.concentracion, p.unidadesCaja ? `x${p.unidadesCaja}` : null].filter(Boolean).join(' ');
}

/** Nombre de la empresa en la ficha: «Ryan» para Ryan, «Farmalógica» para Farmalógica. */
export function nombreEmpresaVitrina(idCompany: number, companyName: string): string {
  return fuenteDeEmpresa(idCompany)?.nombre ?? companyName.trim();
}

/** Índice vecino en el modo presentación (sin dar la vuelta: en los extremos se queda). */
export function indiceVecino(total: number, actual: number, paso: -1 | 1): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(actual + paso, 0), total - 1);
}

/** Índice de arranque del modo presentación: el de la presentación pedida, o 0. */
export function indiceInicial(items: readonly { id: number }[], idInicial: number | null | undefined): number {
  if (!idInicial) return 0;
  const i = items.findIndex((p) => p.id === idInicial);
  return i < 0 ? 0 : i;
}
