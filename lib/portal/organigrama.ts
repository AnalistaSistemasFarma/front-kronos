/**
 * PORTAL TH — ORGANIGRAMA DIGITAL E INTERACTIVO (Cristian Baldión, 2026-10-15).
 *
 * El organigrama de Farmalógica (GTH-01-FR-005-5, PDF) se convirtió en datos: `organigrama-datos.json` trae las franjas, los
 * 122 cuadros con su posición y su cargo, y los conectores. La pantalla lo dibuja y, al pulsar un cargo, muestra a las personas
 * de BASE PERSONAL (SharePoint) que tienen ese cargo.
 *
 * Este archivo es PURO (sin red): normaliza cargos, enlaza cuadros con personas y calcula cómo cabe el texto en cada cuadro.
 * Los 63 cuadros angostos del PDF tenían el texto girado y guardado como dibujo; se leyeron con OCR y se revisaron uno a uno.
 */
import datos from './organigrama-datos.json';

export interface NodoOrganigrama {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Texto girado 90° (cuadros angostos). */
  v: boolean;
  /** El cargo tal como está escrito en el dibujo. */
  texto: string;
}

export interface FranjaOrganigrama {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

export interface ModeloOrganigrama {
  /** x, y, ancho y alto del dibujo (viewBox). */
  vista: [number, number, number, number];
  bandas: FranjaOrganigrama[];
  nodos: NodoOrganigrama[];
  conectores: { d: string; w: number }[];
}

export const MODELO: ModeloOrganigrama = datos as unknown as ModeloOrganigrama;
export const NOMBRE_FRANJAS = ['ESTRATÉGICO', 'TÁCTICO', 'OPERATIVO'] as const;
/**
 * La empresa cuyas personas se muestran POR DEFECTO al pulsar un cargo (Cristian, 2026-10-15: GSS). El organigrama dibujado es el
 * de Farmalógica, pero la ventana arranca con GSS y un interruptor permite incluir a las demás empresas.
 */
export const EMPRESA_POR_DEFECTO = 'GSS';

/** Una persona de BASE PERSONAL tal como se muestra. NUNCA lleva la cédula. */
export interface PersonaOrganigrama {
  empresa: string;
  nombre: string;
  area: string;
  cargo: string;
  correo: string;
}

const sinTildes = (t: string) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** Mayúsculas, sin tildes ni signos, espacios colapsados; «Aux.» = AUXILIAR y «Gte.» = GERENTE. */
export function normalizarCargo(texto: unknown): string {
  const t = sinTildes(String(texto ?? '')).toUpperCase().replace(/\bAUX\b\.?/g, 'AUXILIAR').replace(/\bGTE\b\.?/g, 'GERENTE');
  return t.replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export const normalizarEmpresa = (texto: unknown): string => normalizarCargo(texto);

/**
 * El cargo del dibujo y el de BASE PERSONAL a veces se escriben distinto (artículos, «Aux.», una errata). Estas son las
 * equivalencias REVISADAS una por una; todo lo demás debe coincidir tal cual (sin tildes ni mayúsculas).
 * Formato: [cargo en el dibujo, cargo en BASE PERSONAL].
 */
export const EQUIVALENCIAS: ReadonlyArray<readonly [string, string]> = [
  ['Aux. de Controloes en Procesos', 'AUXILIAR DE CONTROLES EN PROCESO'],
  ['Aux. de Oficina de Garantia y Calidad', 'AUXILIAR DE OFICINA-GARANTIA DE CALIDAD'],
  ['Auxiliar de Almacén de Producción', 'AUXILIAR ALMACEN DE PRODUCCION'],
  ['Inspector de Calidad de Planta', 'INSPECTOR DE CALIDAD PLANTA'],
  ['Representante en Ventas', 'REPRESENTANTE DE VENTAS'],
  ['Analista Capital de Trabajo', 'ANALISTA DE CAPITAL DE TRABAJO'],
  ['Analista Data Analisis', 'ANALISTA DE DATA ANALISIS'],
  ['Analista Documental Control de Calidad', 'ANALISTA DOCUMENTAL DE CONTROL DE CALIDAD'],
  ['Analista Junior de Microbiología', 'ANALISTA DE MICROBIOLOGIA JUNIOR'],
  ['Analista de Nómina Contratación', 'ANALISTA DE NOMINA Y CONTRATACION'],
  ['Coordinador de Nómina Contratación', 'COORDINADOR DE NOMINA Y CONTRATACION'],
  ['Analista de Tecnovigilancia', 'ANALISTA DE TECNOVIGILACIA'],
  ['Coordinador Seguridad y Salud en el Trabajo', 'COORDINADOR DE SEGURIDAD Y SALUD EN EL TRABAJO'],
  ['Coordinador de Capital de Trabajo', 'COORDINADOR CAPITAL DE TRABAJO'],
  ['Coordinador de Costos e Inventario', 'COORDINADOR COSTOS E INVENTARIO'],
  ['Especialista en Compras', 'ESPECIALISTA DE COMPRAS'],
  ['Jefe Asuntos Regulatorios', 'JEFE DE ASUNTOS REGULATORIOS'],
  ['Jefe Infrastructura', 'JEFE INFRAESTRUCTURA'],
  ['Jefe Planeación', 'JEFE DE PLANEACION'],
  ['Mensajero', 'MENSAJERIA'],
];

const MAPA_EQUIVALENCIAS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [dibujo, base] of EQUIVALENCIAS) {
    const k = normalizarCargo(dibujo);
    m.set(k, [...(m.get(k) ?? []), normalizarCargo(base)]);
  }
  return m;
})();

/** Los cargos de BASE PERSONAL que corresponden a un cuadro del dibujo. */
export function cargosDelNodo(nodo: Pick<NodoOrganigrama, 'texto'>): string[] {
  const k = normalizarCargo(nodo.texto);
  return [k, ...(MAPA_EQUIVALENCIAS.get(k) ?? [])];
}

/**
 * Enlaza cada cuadro con las personas de su cargo. Devuelve SOLO los cuadros que tienen al menos una persona, y solo
 * las personas de esos cargos: del resto de BASE PERSONAL no sale nada hacia el navegador.
 */
export function personasPorNodo(nodos: Pick<NodoOrganigrama, 'id' | 'texto'>[], personas: PersonaOrganigrama[]): Record<number, PersonaOrganigrama[]> {
  const porCargo = new Map<string, PersonaOrganigrama[]>();
  for (const p of personas) {
    const k = normalizarCargo(p.cargo);
    if (!k) continue;
    porCargo.set(k, [...(porCargo.get(k) ?? []), p]);
  }
  const salida: Record<number, PersonaOrganigrama[]> = {};
  for (const n of nodos) {
    const lista = cargosDelNodo(n).flatMap((c) => porCargo.get(c) ?? []);
    if (lista.length > 0) {
      salida[n.id] = lista
        .slice()
        .sort((a, b) => a.empresa.localeCompare(b.empresa, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
    }
  }
  return salida;
}

/** Cuadros que no tienen a nadie en BASE PERSONAL (para avisarlo; no es un error). */
export const nodosSinPersonas = (nodos: NodoOrganigrama[], enlace: Record<number, unknown[]>) => nodos.filter((n) => !enlace[n.id]?.length);

/* ── Texto dentro del cuadro ───────────────────────────────────────────────────────────────── */

const ANCHO_CARACTER = 0.5; // × tamaño: promedio de Calibri
const ALTO_LINEA = 1.2;
export const TAMANO_TEXTO_MAX = 18;
export const TAMANO_TEXTO_MIN = 10;

/** Parte el texto en líneas que quepan en `ancho` con la letra de tamaño `tam`. */
export function partirEnLineas(texto: string, ancho: number, tam: number): string[] {
  const maximo = Math.max(4, Math.floor(ancho / (ANCHO_CARACTER * tam)));
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (prueba.length <= maximo || !actual) actual = prueba;
    else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/** La letra más grande (hasta `TAMANO_TEXTO_MAX`) con la que el texto entra en el cuadro; si no cabe, la mínima. */
export function ajustarTexto(texto: string, ancho: number, alto: number): { lineas: string[]; tam: number } {
  for (let tam = TAMANO_TEXTO_MAX; tam >= TAMANO_TEXTO_MIN; tam -= 1) {
    const lineas = partirEnLineas(texto, ancho, tam);
    if (lineas.length * tam * ALTO_LINEA <= alto) return { lineas, tam };
  }
  return { lineas: partirEnLineas(texto, ancho, TAMANO_TEXTO_MIN), tam: TAMANO_TEXTO_MIN };
}

/** Texto que se dibuja en un cuadro: en los angostos va girado, así que «ancho» es su alto. */
export function textoDelNodo(n: NodoOrganigrama) {
  const margen = 16;
  const largo = (n.v ? n.h : n.w) - margen * 2;
  const grueso = (n.v ? n.w : n.h) - 10;
  return ajustarTexto(n.texto, largo, grueso);
}

/** ¿El cuadro coincide con lo buscado (cargo o alguna de sus personas)? Sin tildes ni mayúsculas, todas las palabras. */
export function coincideBusqueda(nodo: Pick<NodoOrganigrama, 'texto'>, personas: PersonaOrganigrama[] | undefined, consulta: string): boolean {
  const palabras = normalizarCargo(consulta).split(' ').filter(Boolean);
  if (palabras.length === 0) return false;
  const texto = [nodo.texto, ...(personas ?? []).map((p) => p.nombre)].map(normalizarCargo).join(' ');
  return palabras.every((p) => texto.includes(p));
}
