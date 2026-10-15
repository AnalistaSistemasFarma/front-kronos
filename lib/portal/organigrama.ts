/**
 * PORTAL DE TALENTO HUMANO — ORGANIGRAMA DE GSS, digital e interactivo (Cristian Baldión, 2026-10-15).
 *
 * El organigrama vive en SynerLink (módulo Organigrama: tablas `cargo` y `cargo_jerarquia`) y el portal lo LEE de ahí: una sola
 * fuente de verdad. La estructura es la del PDF vigente (GTH-01-FR-005-5), cargada con `prisma/seeds/organigrama-gss.cjs`.
 * Al pulsar un cargo se muestran las personas de BASE PERSONAL (SharePoint) que lo tienen.
 *
 * Este archivo es PURO (sin red ni base): normaliza cargos, los enlaza con personas, y calcula el DISEÑO del árbol (dónde va
 * cada cuadro y las líneas), porque la base solo guarda quién reporta a quién, no posiciones.
 */

/** Un cargo del organigrama tal como lo entrega la API. */
export interface NodoCargo {
  /** id_cargo */
  id: number;
  /** Nombre normalizado de la base (mayúsculas, sin tildes). */
  nombre: string;
  /** Estratégico / Táctico / Operativo. */
  nivel: string | null;
  /** id_cargo del jefe; null = la cima. */
  padre: number | null;
}

/** La empresa cuyas personas se muestran POR DEFECTO al pulsar un cargo (Cristian, 2026-10-15: GSS). */
export const EMPRESA_POR_DEFECTO = 'GSS';
/** Empresa del organigrama que se lee de la base. */
export const EMPRESA_DEL_ORGANIGRAMA = 'GSS';

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

const MINUSCULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'EN', 'EL', 'A', 'O', 'POR', 'PARA', 'CON']);
const SIGLAS = new Set(['SST', 'RS', 'TI', 'I', 'II', 'III', 'IV', 'BPM', 'SGC']);

/** «SUBGERENTE DE GARANTIA DE CALIDAD» → «Subgerente de Garantia de Calidad» (la base no guarda tildes). */
export function nombreLegible(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => {
      if (SIGLAS.has(p)) return p;
      if (i > 0 && MINUSCULAS.has(p)) return p.toLowerCase();
      return p.charAt(0) + p.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * El cargo del organigrama y el de BASE PERSONAL a veces se escriben distinto (artículos, una errata). Estas son las equivalencias
 * REVISADAS una por una; todo lo demás debe coincidir tal cual (sin tildes ni mayúsculas).
 * Formato: [cargo en el organigrama, cargo en BASE PERSONAL].
 */
export const EQUIVALENCIAS: ReadonlyArray<readonly [string, string]> = [
  ['AUXILIAR DE CONTROLES EN PROCESOS', 'AUXILIAR DE CONTROLES EN PROCESO'],
  ['AUXILIAR DE OFICINA DE GARANTIA Y CALIDAD', 'AUXILIAR DE OFICINA-GARANTIA DE CALIDAD'],
  ['AUXILIAR DE ALMACEN DE PRODUCCION', 'AUXILIAR ALMACEN DE PRODUCCION'],
  ['INSPECTOR DE CALIDAD DE PLANTA', 'INSPECTOR DE CALIDAD PLANTA'],
  ['REPRESENTANTE EN VENTAS', 'REPRESENTANTE DE VENTAS'],
  ['ANALISTA CAPITAL DE TRABAJO', 'ANALISTA DE CAPITAL DE TRABAJO'],
  ['ANALISTA DATA ANALISIS', 'ANALISTA DE DATA ANALISIS'],
  ['ANALISTA DOCUMENTAL CONTROL DE CALIDAD', 'ANALISTA DOCUMENTAL DE CONTROL DE CALIDAD'],
  ['ANALISTA JUNIOR DE MICROBIOLOGIA', 'ANALISTA DE MICROBIOLOGIA JUNIOR'],
  ['ANALISTA DE NOMINA CONTRATACION', 'ANALISTA DE NOMINA Y CONTRATACION'],
  ['COORDINADOR DE NOMINA CONTRATACION', 'COORDINADOR DE NOMINA Y CONTRATACION'],
  ['ANALISTA DE TECNOVIGILANCIA', 'ANALISTA DE TECNOVIGILACIA'],
  ['COORDINADOR SEGURIDAD Y SALUD EN EL TRABAJO', 'COORDINADOR DE SEGURIDAD Y SALUD EN EL TRABAJO'],
  ['COORDINADOR DE CAPITAL DE TRABAJO', 'COORDINADOR CAPITAL DE TRABAJO'],
  ['COORDINADOR DE COSTOS E INVENTARIO', 'COORDINADOR COSTOS E INVENTARIO'],
  ['ESPECIALISTA EN COMPRAS', 'ESPECIALISTA DE COMPRAS'],
  ['JEFE ASUNTOS REGULATORIOS', 'JEFE DE ASUNTOS REGULATORIOS'],
  ['JEFE PLANEACION', 'JEFE DE PLANEACION'],
  ['MENSAJERO', 'MENSAJERIA'],
];

const MAPA_EQUIVALENCIAS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [organigrama, base] of EQUIVALENCIAS) {
    const k = normalizarCargo(organigrama);
    m.set(k, [...(m.get(k) ?? []), normalizarCargo(base)]);
  }
  return m;
})();

/** Los cargos de BASE PERSONAL que corresponden a un cuadro del organigrama. */
export function cargosDelNodo(nodo: Pick<NodoCargo, 'nombre'>): string[] {
  const k = normalizarCargo(nodo.nombre);
  return [k, ...(MAPA_EQUIVALENCIAS.get(k) ?? [])];
}

/**
 * Enlaza cada cuadro con las personas de su cargo. Devuelve SOLO los cuadros que tienen al menos una persona, y solo las
 * personas de esos cargos: del resto de BASE PERSONAL no sale nada hacia el navegador.
 */
export function personasPorNodo(nodos: Pick<NodoCargo, 'id' | 'nombre'>[], personas: PersonaOrganigrama[]): Record<number, PersonaOrganigrama[]> {
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
      // Se copian SOLO los cinco datos que se muestran: aunque la lectura de origen traiga más columnas, no salen de aquí.
      salida[n.id] = lista
        .map((p) => ({ empresa: p.empresa, nombre: p.nombre, area: p.area, cargo: p.cargo, correo: p.correo }))
        .sort((a, b) => a.empresa.localeCompare(b.empresa, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
    }
  }
  return salida;
}

/** Cuadros que no tienen a nadie en BASE PERSONAL (para avisarlo; no es un error). */
export const nodosSinPersonas = (nodos: NodoCargo[], enlace: Record<number, unknown[]>) => nodos.filter((n) => !enlace[n.id]?.length);

/* ── Diseño del árbol ──────────────────────────────────────────────────────────────────────── */

export const ANCHO_CUADRO = 230;
export const ALTO_CUADRO = 64;
const SEPARACION_X = 28;
const SEPARACION_Y = 70;
/** Los cargos que no tienen subordinados se apilan en una lista bajo su jefe, con esta sangría. */
const SANGRIA = 28;
const FILA_LISTA = ALTO_CUADRO + 14;
const MARGEN = 30;

export interface CuadroDisenado {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DisenoOrganigrama {
  cuadros: CuadroDisenado[];
  /** Líneas (atributo `d` de un <path>), de jefe a subordinado. */
  caminos: string[];
  /** x, y, ancho y alto del dibujo (viewBox). */
  vista: [number, number, number, number];
}

/** Hijos de cada cargo, por nombre (orden estable). Los cargos con un jefe que no existe quedan como cimas. */
export function hijosPorCargo(nodos: NodoCargo[]): { raices: NodoCargo[]; hijos: Map<number, NodoCargo[]> } {
  const ids = new Set(nodos.map((n) => n.id));
  const hijos = new Map<number, NodoCargo[]>();
  const raices: NodoCargo[] = [];
  for (const n of nodos) {
    if (n.padre === null || !ids.has(n.padre) || n.padre === n.id) raices.push(n);
    else hijos.set(n.padre, [...(hijos.get(n.padre) ?? []), n]);
  }
  const orden = (a: NodoCargo, b: NodoCargo) => a.nombre.localeCompare(b.nombre, 'es');
  for (const [k, v] of hijos) hijos.set(k, v.slice().sort(orden));
  return { raices: raices.sort(orden), hijos };
}

/**
 * Calcula dónde va cada cuadro. Los jefes quedan centrados sobre sus subordinados; los cargos que no tienen subordinados se apilan
 * en columna bajo su jefe (como en el organigrama en papel), para que el dibujo no sea kilométrico. Un ciclo en los datos no
 * cuelga el cálculo: cada cargo se coloca una sola vez.
 */
export function disenarOrganigrama(nodos: NodoCargo[]): DisenoOrganigrama {
  const { raices, hijos } = hijosPorCargo(nodos);
  const colocado = new Set<number>();
  const cuadros: CuadroDisenado[] = [];
  const caminos: string[] = [];
  const hijosDe = (n: NodoCargo) => hijos.get(n.id) ?? [];

  const esLista = (n: NodoCargo) => {
    const hs = hijosDe(n);
    return hs.length > 0 && hs.every((h) => (hijos.get(h.id) ?? []).length === 0);
  };
  const ancho = (n: NodoCargo, visto: Set<number>): number => {
    if (visto.has(n.id)) return ANCHO_CUADRO;
    visto.add(n.id);
    const hs = hijosDe(n);
    if (hs.length === 0) return ANCHO_CUADRO;
    if (esLista(n)) return ANCHO_CUADRO + SANGRIA;
    const total = hs.reduce((s, h) => s + ancho(h, visto), 0) + SEPARACION_X * (hs.length - 1);
    return Math.max(ANCHO_CUADRO, total);
  };

  /** Coloca el subárbol de `n` con su borde izquierdo en `xIzq` y su cuadro en la fila `y`. Devuelve el centro x del cuadro. */
  const colocar = (n: NodoCargo, xIzq: number, y: number): number => {
    colocado.add(n.id);
    const hs = hijosDe(n).filter((h) => !colocado.has(h.id));
    if (hs.length === 0) {
      cuadros.push({ id: n.id, x: xIzq, y, w: ANCHO_CUADRO, h: ALTO_CUADRO });
      return xIzq + ANCHO_CUADRO / 2;
    }
    if (esLista(n)) {
      cuadros.push({ id: n.id, x: xIzq, y, w: ANCHO_CUADRO, h: ALTO_CUADRO });
      const xTronco = xIzq + SANGRIA / 2;
      let yFila = y + ALTO_CUADRO + 20;
      let ultimoY = y + ALTO_CUADRO;
      for (const h of hs) {
        colocado.add(h.id);
        cuadros.push({ id: h.id, x: xIzq + SANGRIA, y: yFila, w: ANCHO_CUADRO, h: ALTO_CUADRO });
        ultimoY = yFila + ALTO_CUADRO / 2;
        caminos.push(`M${xTronco} ${ultimoY}H${xIzq + SANGRIA}`);
        yFila += FILA_LISTA;
      }
      caminos.push(`M${xTronco} ${y + ALTO_CUADRO}V${ultimoY}`);
      return xIzq + ANCHO_CUADRO / 2;
    }
    let x = xIzq;
    const centros: number[] = [];
    const yHijos = y + ALTO_CUADRO + SEPARACION_Y;
    for (const h of hs) {
      const w = ancho(h, new Set());
      centros.push(colocar(h, x, yHijos));
      x += w + SEPARACION_X;
    }
    const centro = (centros[0] + centros[centros.length - 1]) / 2;
    cuadros.push({ id: n.id, x: centro - ANCHO_CUADRO / 2, y, w: ANCHO_CUADRO, h: ALTO_CUADRO });
    const yBus = y + ALTO_CUADRO + SEPARACION_Y / 2;
    for (const cx of centros) caminos.push(`M${centro} ${y + ALTO_CUADRO}V${yBus}H${cx}V${yHijos}`);
    return centro;
  };

  let x = 0;
  for (const raiz of raices) {
    if (colocado.has(raiz.id)) continue;
    const w = ancho(raiz, new Set());
    colocar(raiz, x, 0);
    x += w + SEPARACION_X * 3;
  }
  // Cualquier cargo que no se alcanzó (un ciclo sin cima) se coloca aparte, para que nada desaparezca.
  for (const n of nodos) {
    if (colocado.has(n.id)) continue;
    colocado.add(n.id);
    cuadros.push({ id: n.id, x, y: 0, w: ANCHO_CUADRO, h: ALTO_CUADRO });
    x += ANCHO_CUADRO + SEPARACION_X;
  }

  const minX = Math.min(...cuadros.map((c) => c.x), 0);
  const minY = Math.min(...cuadros.map((c) => c.y), 0);
  const maxX = Math.max(...cuadros.map((c) => c.x + c.w), ANCHO_CUADRO);
  const maxY = Math.max(...cuadros.map((c) => c.y + c.h), ALTO_CUADRO);
  return { cuadros, caminos, vista: [minX - MARGEN, minY - MARGEN, maxX - minX + MARGEN * 2, maxY - minY + MARGEN * 2] };
}

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

/** Texto que se dibuja en un cuadro. */
export function textoDelNodo(nombre: string, cuadro: Pick<CuadroDisenado, 'w' | 'h'> = { w: ANCHO_CUADRO, h: ALTO_CUADRO }) {
  return ajustarTexto(nombreLegible(nombre), cuadro.w - 16, cuadro.h - 10);
}

/** ¿El cuadro coincide con lo buscado (cargo o alguna de sus personas)? Sin tildes ni mayúsculas, todas las palabras. */
export function coincideBusqueda(nodo: Pick<NodoCargo, 'nombre'>, personas: PersonaOrganigrama[] | undefined, consulta: string): boolean {
  const palabras = normalizarCargo(consulta).split(' ').filter(Boolean);
  if (palabras.length === 0) return false;
  const texto = [nodo.nombre, ...(personas ?? []).map((p) => p.nombre)].map(normalizarCargo).join(' ');
  return palabras.every((p) => texto.includes(p));
}
