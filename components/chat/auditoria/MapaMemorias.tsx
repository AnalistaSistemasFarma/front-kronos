"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

/**
 * Lienzo del mapa de memorias (vista gráfica tipo Obsidian), sin dependencias.
 *
 * RENDIMIENTO (2026-10-29: la primera versión tardaba ~3 min en acomodar 1.700
 * nodos y congelaba el equipo):
 *   - La simulación de fuerzas corre SOLO sobre la estructura (grupos,
 *     departamentos y agentes: decenas de nodos). Cada estructura ocupa un
 *     círculo del tamaño de su nube de memorias, así no se pisan.
 *   - Las memorias se ubican en espiral de girasol alrededor de su dueño:
 *     costo lineal, sin simulación.
 *   - Dibujo con requestAnimationFrame (máximo uno por cuadro), memorias y
 *     enlaces agrupados en un solo trazo por color, sin sombras por nodo,
 *     minimapa en caché y tope de rótulos.
 */

export type TipoNodo = "grupo" | "depto" | "agente" | "memoria";

export interface NodoMapa {
  id: string;
  tipo: TipoNodo;
  etiqueta: string;
  grupo: string;
  color: string;
  /** Para filtros y detalle (lo usa la página). */
  idMemoria?: number;
  idAgente?: number;
  depto?: string | null;
  tipoMemoria?: string;
}
export interface EnlaceMapa {
  s: string;
  t: string;
  /** h = jerarquía; own = dueño→memoria; mm = entre memorias del mismo grupo; x = entre grupos. */
  k: "h" | "own" | "mm" | "x";
}
export interface GrupoMapa {
  id: string;
  nombre: string;
  color: string;
}

interface Sim extends NodoMapa {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radio que ocupa (su nube de memorias incluida). */
  r: number;
  vecinos: Sim[];
  /** Memorias que cuelgan de este nodo (espiral). */
  hijos: Sim[];
}
interface Lazo {
  s: Sim;
  t: Sim;
  k: EnlaceMapa["k"];
}

export interface MapaMemoriasHandle {
  acercar: () => void;
  alejar: () => void;
  ajustar: () => void;
  enfocar: (ids: string[]) => void;
}

/** Colores del lienzo para cada tema (fondos = --surface de app/globals.css). */
const TEMAS = {
  claro: {
    fondo: "#ffffff",
    punto: "rgba(26,29,33,.07)",
    tenue: "rgba(26,29,33,.035)",
    cruce: "rgba(26,29,33,.18)",
    lazo: "rgba(26,29,33,.08)",
    tinta: "#1a1d21",
    tinta2: "#343a40",
    halo: "rgba(255,255,255,.95)",
    relleno: "#ffffff",
    mini: "rgba(255,255,255,.92)",
  },
  oscuro: {
    fondo: "#28292e",
    punto: "rgba(255,255,255,.06)",
    tenue: "rgba(255,255,255,.035)",
    cruce: "rgba(255,255,255,.22)",
    lazo: "rgba(255,255,255,.09)",
    tinta: "#f3f4f6",
    tinta2: "#d0d4da",
    halo: "rgba(40,41,46,.95)",
    relleno: "#303238",
    mini: "rgba(40,41,46,.92)",
  },
} as const;

interface Props {
  nodos: NodoMapa[];
  enlaces: EnlaceMapa[];
  grupos: GrupoMapa[];
  visible: (n: NodoMapa) => boolean;
  resaltados: Set<string> | null;
  seleccionado: string | null;
  mostrarZonas: boolean;
  onSeleccionar: (id: string | null) => void;
  /** Cambia cuando el contenedor cambia de tamaño (pantalla completa). */
  version: number;
  /** Tema de SynerLink (modo oscuro del usuario). */
  oscuro: boolean;
}

/**
 * Colores del tema con el fondo REAL de la tarjeta: la paleta de cada usuario
 * cambia --app-surface (p. ej. duo-turquesa en oscuro), así que no sirve un gris fijo.
 */
function colores(oscuro: boolean) {
  const base = oscuro ? TEMAS.oscuro : TEMAS.claro;
  if (typeof window === "undefined") return base;
  const css = getComputedStyle(document.documentElement);
  const fondo = css.getPropertyValue("--app-surface").trim();
  const elevado = css.getPropertyValue("--app-surface-raised").trim();
  if (!/^#[0-9a-f]{6}$/i.test(fondo)) return base;
  return {
    ...base,
    fondo,
    relleno: /^#[0-9a-f]{6}$/i.test(elevado) ? elevado : fondo,
    halo: hexA(fondo, 0.95),
    mini: hexA(fondo, 0.92),
  };
}

const FUENTE = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
/** Separación entre memorias en la espiral (unidades del mundo). */
const PASO_ESPIRAL = 11;
const ANGULO_DORADO = Math.PI * (3 - Math.sqrt(5));
/** Tope de rótulos de memorias por cuadro (más no se leen y cuestan). */
const MAX_ROTULOS = 140;

function hexA(h: string, a: number): string {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function corta(s: string, max = 56): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Semilla fija: el mismo grafo siempre queda igual. */
function aleatorio(semilla: number) {
  let s = semilla % 2147483647 || 7;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const radioBase = (n: Sim) =>
  n.tipo === "grupo" ? 26 : n.tipo === "depto" ? 12 : 16;

/** Ubica las memorias de un dueño en espiral de girasol a su alrededor. */
function espiral(dueno: Sim) {
  const r0 = radioBase(dueno) + 12;
  dueno.hijos.forEach((m, i) => {
    const rr = r0 + PASO_ESPIRAL * Math.sqrt(i + 0.5);
    const a = i * ANGULO_DORADO;
    m.x = dueno.x + Math.cos(a) * rr;
    m.y = dueno.y + Math.sin(a) * rr;
  });
}

/**
 * Disposición en dos pasos: fuerzas sobre la estructura (decenas de nodos) y
 * espirales para las memorias. Costo ~ O(E² · iteraciones + N), E = estructura.
 */
export function disponer(nodos: Sim[], lazos: Lazo[], grupos: GrupoMapa[]) {
  const rnd = aleatorio(nodos.length * 31 + lazos.length);
  for (const n of nodos) n.hijos = [];
  const hubDe = new Map<string, Sim>();
  for (const n of nodos) if (n.tipo === "grupo") hubDe.set(n.grupo, n);
  const conDueno = new Set<Sim>();
  for (const l of lazos) {
    if (l.k !== "own" || l.t.tipo !== "memoria" || l.s.tipo === "memoria")
      continue;
    if (conDueno.has(l.t)) continue;
    l.s.hijos.push(l.t);
    conDueno.add(l.t);
  }
  for (const n of nodos) {
    if (n.tipo !== "memoria" || conDueno.has(n)) continue;
    hubDe.get(n.grupo)?.hijos.push(n);
  }
  // Ordenar cada nube por tipo y título: lo parecido queda junto.
  for (const n of nodos)
    n.hijos.sort(
      (a, b) =>
        (a.tipoMemoria ?? "").localeCompare(b.tipoMemoria ?? "") ||
        a.etiqueta.localeCompare(b.etiqueta),
    );

  const est = nodos.filter((n) => n.tipo !== "memoria");
  for (const n of est)
    n.r =
      radioBase(n) +
      (n.hijos.length ? 12 + PASO_ESPIRAL * Math.sqrt(n.hijos.length) : 0);
  const lazosEst = lazos.filter(
    (l) => l.s.tipo !== "memoria" && l.t.tipo !== "memoria",
  );

  // Anclas de los grupos según su área: el más grande al centro, los demás en
  // anillo. Si hay nodos fuera de los grupos (los agentes del mapa personal),
  // el centro es para ellos.
  const area = new Map<string, number>();
  for (const n of est)
    area.set(n.grupo, (area.get(n.grupo) ?? 0) + (n.r + 30) ** 2);
  const radioGrupo = (g: string) => Math.sqrt(area.get(g) ?? 900) * 1.2;
  const ids = new Set(grupos.map((g) => g.id));
  const centroLibre = est.some((n) => !ids.has(n.grupo));
  const orden = [...grupos]
    .filter((g) => area.has(g.id))
    .sort((a, b) => radioGrupo(b.id) - radioGrupo(a.id));
  const anclas = new Map<string, { x: number; y: number }>();
  const central = centroLibre ? null : orden[0];
  const anillo = orden.filter((g) => g !== central);
  const rCentro = central
    ? radioGrupo(central.id)
    : Math.sqrt(
        est
          .filter((n) => !ids.has(n.grupo))
          .reduce((s, n) => s + (n.r + 30) ** 2, 0),
      ) * 1.2;
  const rAnillo =
    rCentro +
    Math.max(0, ...anillo.map((g) => radioGrupo(g.id))) +
    Math.max(160, (anillo.length * 140) / Math.PI);
  if (central) anclas.set(central.id, { x: 0, y: 0 });
  anillo.forEach((g, i) => {
    const a = (i / Math.max(1, anillo.length)) * Math.PI * 2 - Math.PI / 2;
    anclas.set(g.id, {
      x: Math.cos(a) * rAnillo * 1.15,
      y: Math.sin(a) * rAnillo * 0.85,
    });
  });
  const anclaDe = (n: Sim) => anclas.get(n.grupo) ?? { x: 0, y: 0 };
  for (const n of est) {
    const a = anclaDe(n);
    const ang = rnd() * Math.PI * 2;
    const d = rnd() * radioGrupo(n.grupo) * 0.5;
    n.x = a.x + Math.cos(ang) * d;
    n.y = a.y + Math.sin(ang) * d;
    n.vx = 0;
    n.vy = 0;
  }

  const ITER = 360;
  for (let it = 0; it < ITER; it++) {
    const alfa = 1 - it / ITER;
    for (let i = 0; i < est.length; i++) {
      const a = est[i];
      for (let j = i + 1; j < est.length; j++) {
        const b = est[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.01) {
          dx = rnd() - 0.5;
          dy = rnd() - 0.5;
          d = 0.5;
        }
        const ux = dx / d;
        const uy = dy / d;
        // Repulsión suave + choque duro entre círculos.
        let f = (900 * alfa) / d;
        const min = a.r + b.r + 26;
        if (d < min) f += (min - d) * 0.5;
        a.vx -= ux * f;
        a.vy -= uy * f;
        b.vx += ux * f;
        b.vy += uy * f;
      }
    }
    for (const l of lazosEst) {
      const dx = l.t.x - l.s.x;
      const dy = l.t.y - l.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const largo = l.s.r + l.t.r + 50;
      const k = ((d - largo) / d) * 0.08;
      l.s.vx += dx * k;
      l.s.vy += dy * k;
      l.t.vx -= dx * k;
      l.t.vy -= dy * k;
    }
    for (const n of est) {
      const a = anclaDe(n);
      const g = n.tipo === "grupo" ? 0.06 : 0.012;
      n.vx += (a.x - n.x) * g * (0.3 + alfa);
      n.vy += (a.y - n.y) * g * (0.3 + alfa);
      n.vx *= 0.5;
      n.vy *= 0.5;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
  // Pasadas finales solo de choque: que ninguna nube pise a otra.
  for (let it = 0; it < 40; it++)
    for (let i = 0; i < est.length; i++)
      for (let j = i + 1; j < est.length; j++) {
        const a = est[i];
        const b = est[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const min = a.r + b.r + 20;
        if (d >= min) continue;
        const e = (min - d) / 2;
        a.x -= (dx / d) * e;
        a.y -= (dy / d) * e;
        b.x += (dx / d) * e;
        b.y += (dy / d) * e;
      }
  // Separar zonas: ninguna empresa (o tema) pisa a otra. Se mueve el grupo
  // entero; son pocas zonas, así que es barato.
  const miembros = new Map<string, Sim[]>();
  for (const n of est) {
    const l = miembros.get(n.grupo);
    if (l) l.push(n);
    else miembros.set(n.grupo, [n]);
  }
  const zonas = [...miembros.values()];
  const circulo = (ns: Sim[]) => {
    let cx = 0;
    let cy = 0;
    for (const n of ns) {
      cx += n.x;
      cy += n.y;
    }
    cx /= ns.length;
    cy /= ns.length;
    let r = 60;
    for (const n of ns)
      r = Math.max(r, Math.hypot(n.x - cx, n.y - cy) + n.r + 30);
    return { cx, cy, r };
  };
  for (let it = 0; it < 60; it++) {
    let movio = false;
    const cs = zonas.map(circulo);
    for (let i = 0; i < zonas.length; i++)
      for (let j = i + 1; j < zonas.length; j++) {
        const a = cs[i];
        const b = cs[j];
        let dx = b.cx - a.cx;
        let dy = b.cy - a.cy;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.01) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const min = a.r + b.r + 70;
        if (d >= min) continue;
        movio = true;
        const e = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        for (const n of zonas[i]) {
          n.x -= ux * e;
          n.y -= uy * e;
        }
        for (const n of zonas[j]) {
          n.x += ux * e;
          n.y += uy * e;
        }
        a.cx -= ux * e;
        a.cy -= uy * e;
        b.cx += ux * e;
        b.cy += uy * e;
      }
    if (!movio) break;
  }
  for (const n of est) espiral(n);
}

export const MapaMemorias = forwardRef<MapaMemoriasHandle, Props>(
  function MapaMemorias(props, ref) {
    const { nodos, enlaces, grupos, version } = props;
    const lienzo = useRef<HTMLCanvasElement>(null);
    const mini = useRef<HTMLCanvasElement>(null);
    const estado = useRef({
      sim: [] as Sim[],
      porId: new Map<string, Sim>(),
      lazos: [] as Lazo[],
      vista: { x: 0, y: 0, k: 0.4 },
      W: 0,
      H: 0,
      hover: null as Sim | null,
      cuadro: 0,
      miniBase: null as HTMLCanvasElement | null,
      /** Geometría del minimapa: origen del mundo, escala y corrimiento. */
      miniGeo: { a: 0, b: 0, s: 1, ox: 0, oy: 0 },
    });
    const props$ = useRef(props);
    props$.current = props;

    const radio = (n: Sim) => {
      const esc = Math.max(0.6, Math.min(1.5, estado.current.vista.k * 1.6));
      return n.tipo === "memoria"
        ? Math.max(1.6, (3 + Math.min(4, n.vecinos.length * 0.6)) * esc)
        : radioBase(n) * esc;
    };
    const toS = (x: number, y: number): [number, number] => {
      const { vista: v, W, H } = estado.current;
      return [(x - v.x) * v.k + W / 2, (y - v.y) * v.k + H / 2];
    };
    const toW = (sx: number, sy: number): [number, number] => {
      const { vista: v, W, H } = estado.current;
      return [(sx - W / 2) / v.k + v.x, (sy - H / 2) / v.k + v.y];
    };

    function limites(): [number, number, number, number] {
      let a = 1e9;
      let b = 1e9;
      let c = -1e9;
      let d = -1e9;
      for (const n of estado.current.sim) {
        if (n.tipo === "memoria" || !props$.current.visible(n)) continue;
        a = Math.min(a, n.x - n.r);
        b = Math.min(b, n.y - n.r);
        c = Math.max(c, n.x + n.r);
        d = Math.max(d, n.y + n.r);
      }
      if (a > c) return [-100, -100, 100, 100];
      return [a, b, c, d];
    }

    /** Minimapa: los puntos se pintan una vez; cada cuadro solo el recuadro. */
    function armarMini() {
      const base = document.createElement("canvas");
      base.width = 360;
      base.height = 232;
      const mx = base.getContext("2d");
      if (!mx) return;
      const [a, b, c, d] = limites();
      const pad = 60;
      const s = Math.min(360 / (c - a + pad * 2), 232 / (d - b + pad * 2));
      const ox = (360 - (c - a + pad * 2) * s) / 2;
      const oy = (232 - (d - b + pad * 2) * s) / 2;
      const porColor = new Map<string, Path2D>();
      for (const n of estado.current.sim) {
        if (!props$.current.visible(n)) continue;
        const p = porColor.get(n.color) ?? new Path2D();
        porColor.set(n.color, p);
        const r = n.tipo === "memoria" ? 1.4 : n.tipo === "grupo" ? 4.5 : 2.6;
        const x = ox + (n.x - a + pad) * s;
        const y = oy + (n.y - b + pad) * s;
        p.moveTo(x + r, y);
        p.arc(x, y, r, 0, Math.PI * 2);
      }
      for (const [color, p] of porColor) {
        mx.fillStyle = hexA(color, 0.8);
        mx.fill(p);
      }
      estado.current.miniBase = base;
      estado.current.miniGeo = { a: a - pad, b: b - pad, s, ox, oy };
    }

    function dibujarMini() {
      const mc = mini.current;
      const mx = mc?.getContext("2d");
      if (!mc || !mx) return;
      if (!estado.current.miniBase) armarMini();
      mx.clearRect(0, 0, 360, 232);
      if (estado.current.miniBase) mx.drawImage(estado.current.miniBase, 0, 0);
      const { a, b, s, ox, oy } = estado.current.miniGeo;
      const [wx1, wy1] = toW(0, 0);
      const [wx2, wy2] = toW(estado.current.W, estado.current.H);
      mx.strokeStyle = "#228be6";
      mx.lineWidth = 2;
      mx.strokeRect(
        ox + (wx1 - a) * s,
        oy + (wy1 - b) * s,
        (wx2 - wx1) * s,
        (wy2 - wy1) * s,
      );
    }

    const dibujar = useCallback(() => {
      const cv = lienzo.current;
      const ctx = cv?.getContext("2d");
      if (!cv || !ctx) return;
      const { sim, lazos, vista, W, H, hover, porId } = estado.current;
      const {
        visible: vis,
        resaltados: q,
        seleccionado: selId,
        mostrarZonas: zonas,
        grupos: gs,
        oscuro,
      } = props$.current;
      const T = colores(oscuro);
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = T.fondo;
      ctx.fillRect(0, 0, W, H);
      const paso = 32 * vista.k;
      if (paso > 10) {
        ctx.fillStyle = T.punto;
        const [ox, oy] = toS(0, 0);
        const sx = ((ox % paso) + paso) % paso;
        const sy = ((oy % paso) + paso) % paso;
        for (let x = sx; x < W; x += paso)
          for (let y = sy; y < H; y += paso) ctx.fillRect(x, y, 1.3, 1.3);
      }
      const sel = selId ? (porId.get(selId) ?? null) : null;
      const foco = hover ?? sel;
      const vec = foco ? new Set<Sim>([foco, ...foco.vecinos]) : null;
      const enPantalla = (x: number, y: number, m = 40) =>
        x > -m && y > -m && x < W + m && y < H + m;

      // Zonas: círculo que envuelve las nubes de la estructura del grupo.
      if (zonas)
        for (const g of gs) {
          let cx = 0;
          let cy = 0;
          let n0 = 0;
          for (const n of sim)
            if (n.grupo === g.id && n.tipo !== "memoria" && vis(n)) {
              cx += n.x;
              cy += n.y;
              n0++;
            }
          if (!n0) continue;
          cx /= n0;
          cy /= n0;
          let r = 60;
          for (const n of sim)
            if (n.grupo === g.id && n.tipo !== "memoria" && vis(n))
              r = Math.max(r, Math.hypot(n.x - cx, n.y - cy) + n.r + 30);
          const [sx, sy] = toS(cx, cy);
          const sr = r * vista.k;
          if (!enPantalla(sx, sy, sr + 40)) continue;
          const dim = foco && foco.grupo !== g.id ? 0.4 : 1;
          ctx.fillStyle = hexA(g.color, 0.06 * dim);
          ctx.beginPath();
          ctx.arc(sx, sy, sr, 0, Math.PI * 2);
          ctx.fill();
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = hexA(g.color, 0.45 * dim);
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = `700 11px ${FUENTE}`;
          const nombre = g.nombre.toUpperCase();
          const tw = ctx.measureText(nombre).width + 16;
          const by = sy - sr - 10;
          ctx.globalAlpha = dim;
          ctx.fillStyle = T.relleno;
          redondeo(ctx, sx - tw / 2, by, tw, 20, 10);
          ctx.fill();
          ctx.strokeStyle = hexA(g.color, 0.6);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = g.color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(nombre, sx, by + 10.5);
          ctx.textBaseline = "alphabetic";
          ctx.globalAlpha = 1;
        }

      // Enlaces: un trazo por estilo. Los dueño→memoria solo de cerca (de
      // lejos la espiral ya dice de quién es cada memoria).
      const trazos = {
        own: new Path2D(),
        mm: new Path2D(),
        x: new Path2D(),
        tenue: new Path2D(),
        foco: new Path2D(),
      };
      const jerarquia = new Map<string, Path2D>();
      const verPropios = vista.k > 0.45;
      for (const l of lazos) {
        if (!vis(l.s) || !vis(l.t)) continue;
        const [x1, y1] = toS(l.s.x, l.s.y);
        const [x2, y2] = toS(l.t.x, l.t.y);
        if (!enPantalla(x1, y1, 400) && !enPantalla(x2, y2, 400)) continue;
        let p: Path2D;
        if (vec) {
          // Un dueño con muchas memorias: la espiral ya dice cuáles son suyas.
          if (l.k === "own" && l.s === foco && foco.hijos.length > 30) continue;
          if (l.s === foco || l.t === foco) p = trazos.foco;
          else if (l.k === "own" && !verPropios) continue;
          else p = trazos.tenue;
        } else if (l.k === "h") {
          p = jerarquia.get(l.s.color) ?? new Path2D();
          jerarquia.set(l.s.color, p);
        } else if (l.k === "own") {
          if (!verPropios) continue;
          p = trazos.own;
        } else p = l.k === "x" ? trazos.x : trazos.mm;
        p.moveTo(x1, y1);
        if (l.k === "x" && !vec) {
          const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15;
          const my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
          p.quadraticCurveTo(mx, my, x2, y2);
        } else p.lineTo(x2, y2);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = T.tenue;
      ctx.stroke(trazos.tenue);
      ctx.strokeStyle = T.lazo;
      ctx.stroke(trazos.own);
      ctx.stroke(trazos.mm);
      ctx.strokeStyle = T.cruce;
      ctx.stroke(trazos.x);
      ctx.lineWidth = 1.5;
      for (const [color, p] of jerarquia) {
        ctx.strokeStyle = hexA(color, 0.5);
        ctx.stroke(p);
      }
      if (foco) {
        ctx.strokeStyle = hexA(foco.color, 0.8);
        ctx.lineWidth = 1.6;
        ctx.stroke(trazos.foco);
      }

      // Memorias: un trazo por color (y por nivel de atenuación).
      const llenos = new Map<string, Path2D>();
      const marcadas: [number, number, number][] = [];
      for (const n of sim) {
        if (n.tipo !== "memoria" || !vis(n)) continue;
        const [x, y] = toS(n.x, n.y);
        if (!enPantalla(x, y)) continue;
        const r = radio(n);
        const apagada = (vec && !vec.has(n)) || (q && !q.has(n.id));
        const clave = `${n.color}|${apagada ? 1 : 0}`;
        const p = llenos.get(clave) ?? new Path2D();
        llenos.set(clave, p);
        p.moveTo(x + r, y);
        p.arc(x, y, r, 0, Math.PI * 2);
        if (n === sel || q?.has(n.id)) marcadas.push([x, y, r]);
      }
      for (const [clave, p] of llenos) {
        const [color, apagada] = clave.split("|");
        ctx.globalAlpha = apagada === "1" ? 0.16 : 1;
        ctx.fillStyle = color;
        ctx.fill(p);
      }
      ctx.globalAlpha = 1;
      if (marcadas.length) {
        ctx.strokeStyle = T.tinta;
        ctx.lineWidth = 1.5;
        const p = new Path2D();
        for (const [x, y, r] of marcadas) {
          p.moveTo(x + r, y);
          p.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.stroke(p);
      }

      // Estructura (decenas de nodos): de a uno.
      for (const tipo of ["depto", "agente", "grupo"] as TipoNodo[])
        for (const n of sim) {
          if (n.tipo !== tipo || !vis(n)) continue;
          const [x, y] = toS(n.x, n.y);
          const r = radio(n);
          if (!enPantalla(x, y, 60)) continue;
          ctx.globalAlpha =
            (vec && !vec.has(n)) || (q && !q.has(n.id)) ? 0.25 : 1;
          if (n.tipo === "depto") {
            ctx.fillStyle = T.relleno;
            ctx.strokeStyle = n.color;
            ctx.lineWidth = 2;
            redondeo(ctx, x - r, y - r, r * 2, r * 2, r * 0.4);
            ctx.fill();
            ctx.stroke();
          } else if (n.tipo === "agente") {
            ctx.fillStyle = T.relleno;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = n.color;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.fillStyle = n.color;
            ctx.font = `700 ${r * 0.9}px ${FUENTE}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(n.etiqueta.slice(0, 1).toUpperCase(), x, y + 1);
            ctx.textBaseline = "alphabetic";
            if (n === sel) {
              ctx.strokeStyle = "#228be6";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(x, y, r + 4, 0, Math.PI * 2);
              ctx.stroke();
            }
          } else {
            ctx.fillStyle = n.color;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = T.fondo;
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        }
      ctx.globalAlpha = 1;

      // Rótulos: estructura según el zoom; memorias solo las del foco o la
      // búsqueda (o todas de muy cerca), con tope.
      let cuenta = 0;
      ctx.lineWidth = 4;
      // Rótulos de memorias sin solaparse (colocación ávida, con tope).
      const ocupados: [number, number, number, number][] = [];
      const libre = (x0: number, y0: number, x1: number, y1: number) => {
        for (const [a, b, c, d] of ocupados)
          if (x0 < c && x1 > a && y0 < d && y1 > b) return false;
        ocupados.push([x0, y0, x1, y1]);
        return true;
      };
      for (const n of sim) {
        if (!vis(n)) continue;
        let rotulo =
          (n.tipo === "grupo" && !zonas) ||
          n.tipo === "agente" ||
          (n.tipo === "depto" && vista.k > 0.4) ||
          (n.tipo === "memoria" &&
            (vec ? vec.has(n) : q ? q.has(n.id) : vista.k > 1.6));
        if (vec && !vec.has(n) && n.tipo !== "grupo") rotulo = false;
        if (!rotulo) continue;
        const [x, y] = toS(n.x, n.y);
        if (!enPantalla(x, y, 10)) continue;
        if (n.tipo === "memoria" && cuenta >= MAX_ROTULOS) continue;
        const r = radio(n);
        const fs =
          n.tipo === "grupo"
            ? 13
            : n.tipo === "agente"
              ? 12
              : n.tipo === "depto"
                ? 10.5
                : 11.5;
        ctx.font = `${n.tipo === "memoria" ? 400 : n.tipo === "depto" ? 700 : 600} ${fs}px ${FUENTE}`;
        ctx.textAlign = "center";
        const txt =
          n.tipo === "depto" ? n.etiqueta.toUpperCase() : corta(n.etiqueta);
        let tx = x;
        let ty = y + r + fs + 3;
        if (foco && n !== foco && n.tipo === "memoria") {
          const [fx, fy] = toS(foco.x, foco.y);
          const an = Math.atan2(y - fy, x - fx);
          tx = x + Math.cos(an) * (r + 5);
          ty = y + Math.sin(an) * (r + 5) + fs * 0.35;
          ctx.textAlign =
            Math.cos(an) > 0.25
              ? "left"
              : Math.cos(an) < -0.25
                ? "right"
                : "center";
        }
        if (n.tipo === "memoria") {
          const w = ctx.measureText(txt).width;
          const x0 =
            ctx.textAlign === "left"
              ? tx
              : ctx.textAlign === "right"
                ? tx - w
                : tx - w / 2;
          if (!libre(x0 - 2, ty - fs, x0 + w + 2, ty + 3)) continue;
          cuenta++;
        }
        ctx.strokeStyle = T.halo;
        ctx.strokeText(txt, tx, ty);
        ctx.fillStyle =
          n.tipo === "depto"
            ? n.color
            : n.tipo === "memoria"
              ? T.tinta2
              : T.tinta;
        ctx.fillText(txt, tx, ty);
      }
      dibujarMini();
    }, []);

    /** Como mucho un dibujo por cuadro de pantalla. */
    const pedirDibujo = useCallback(() => {
      if (estado.current.cuadro) return;
      estado.current.cuadro = requestAnimationFrame(() => {
        estado.current.cuadro = 0;
        dibujar();
      });
    }, [dibujar]);

    function medir() {
      const cv = lienzo.current;
      if (!cv) return;
      const r = cv.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      estado.current.W = r.width;
      estado.current.H = r.height;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
    }

    function ajustar() {
      const [a, b, c, d] = limites();
      const v = estado.current.vista;
      const { W, H } = estado.current;
      v.x = (a + c) / 2;
      v.y = (b + d) / 2 - 20;
      v.k = Math.max(
        0.03,
        Math.min(
          1.6,
          Math.min((W - 40) / (c - a + 120), (H - 110) / (d - b + 160)),
        ),
      );
      pedirDibujo();
    }

    function enfocar(ids: string[]) {
      const ns = ids
        .map((i) => estado.current.porId.get(i))
        .filter((n): n is Sim => Boolean(n));
      if (!ns.length) return;
      let a = 1e9;
      let b = 1e9;
      let c = -1e9;
      let d = -1e9;
      for (const n of ns) {
        const r = n.tipo === "memoria" ? 10 : n.r;
        a = Math.min(a, n.x - r);
        b = Math.min(b, n.y - r);
        c = Math.max(c, n.x + r);
        d = Math.max(d, n.y + r);
      }
      const v = estado.current.vista;
      const { W, H } = estado.current;
      v.x = (a + c) / 2;
      v.y = (b + d) / 2;
      v.k = Math.max(
        0.03,
        Math.min(
          2.2,
          Math.min((W - 80) / (c - a + 260), (H - 140) / (d - b + 260)),
        ),
      );
      pedirDibujo();
    }

    // Construir y disponer cuando cambia el grafo.
    useEffect(() => {
      const sim: Sim[] = nodos.map((n) => ({
        ...n,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        r: 0,
        vecinos: [],
        hijos: [],
      }));
      const porId = new Map(sim.map((n) => [n.id, n]));
      const lazos: Lazo[] = [];
      for (const e of enlaces) {
        const s = porId.get(e.s);
        const t = porId.get(e.t);
        if (!s || !t || s === t) continue;
        lazos.push({ s, t, k: e.k });
        s.vecinos.push(t);
        t.vecinos.push(s);
      }
      disponer(sim, lazos, grupos);
      Object.assign(estado.current, {
        sim,
        porId,
        lazos,
        hover: null,
        miniBase: null,
      });
      medir();
      ajustar();
    }, [nodos, enlaces, grupos]);

    // Filtros, selección, zonas o tema: redibujar (el minimapa se rehace si
    // cambia qué se ve).
    useEffect(() => {
      estado.current.miniBase = null;
      pedirDibujo();
    }, [props.visible, pedirDibujo]);
    useEffect(() => {
      pedirDibujo();
    }, [
      props.resaltados,
      props.seleccionado,
      props.mostrarZonas,
      props.oscuro,
      pedirDibujo,
    ]);

    // Tamaño (ventana y pantalla completa).
    useEffect(() => {
      const alCambiar = () => {
        medir();
        pedirDibujo();
      };
      alCambiar();
      const ro = new ResizeObserver(alCambiar);
      if (lienzo.current) ro.observe(lienzo.current);
      return () => ro.disconnect();
    }, [version]);

    useEffect(
      () => () => {
        if (estado.current.cuadro) cancelAnimationFrame(estado.current.cuadro);
      },
      [],
    );

    useImperativeHandle(ref, () => ({
      acercar: () => {
        estado.current.vista.k = Math.min(4, estado.current.vista.k * 1.3);
        pedirDibujo();
      },
      alejar: () => {
        estado.current.vista.k = Math.max(0.03, estado.current.vista.k / 1.3);
        pedirDibujo();
      },
      ajustar,
      enfocar,
    }));

    // Ratón: arrastrar el lienzo o un nodo, rueda para acercar, clic para elegir.
    useEffect(() => {
      const cv = lienzo.current;
      if (!cv) return;
      let arrastre: {
        n: Sim | null;
        sx: number;
        sy: number;
        vx: number;
        vy: number;
      } | null = null;
      let movio = false;
      const golpe = (sx: number, sy: number): Sim | null => {
        const [wx, wy] = toW(sx, sy);
        const k = estado.current.vista.k;
        let mejor: Sim | null = null;
        let md = 1e9;
        for (const n of estado.current.sim) {
          const dx = n.x - wx;
          const dy = n.y - wy;
          const lim = (radio(n) + 3) / k;
          if (dx > lim || dx < -lim || dy > lim || dy < -lim) continue;
          if (!props$.current.visible(n)) continue;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < lim && d < md) {
            md = d;
            mejor = n;
          }
        }
        return mejor;
      };
      /** Mueve un nodo con todo lo que cuelga de él. */
      const mover = (n: Sim, dx: number, dy: number) => {
        n.x += dx;
        n.y += dy;
        for (const m of n.hijos) {
          m.x += dx;
          m.y += dy;
        }
        if (n.tipo === "grupo" || n.tipo === "depto")
          for (const v of n.vecinos)
            if (
              v.grupo === n.grupo &&
              ((n.tipo === "grupo" && v.tipo === "depto") ||
                (n.tipo === "depto" && v.tipo === "agente"))
            )
              mover(v, dx, dy);
      };
      const pos = (e: MouseEvent) => {
        const r = cv.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top] as const;
      };
      const abajo = (e: MouseEvent) => {
        const [sx, sy] = pos(e);
        const v = estado.current.vista;
        arrastre = { n: golpe(sx, sy), sx, sy, vx: v.x, vy: v.y };
        movio = false;
        cv.style.cursor = "grabbing";
      };
      const alMover = (e: MouseEvent) => {
        const [sx, sy] = pos(e);
        if (arrastre) {
          if (Math.hypot(sx - arrastre.sx, sy - arrastre.sy) > 3) movio = true;
          if (arrastre.n && arrastre.n.tipo !== "memoria") {
            const [wx, wy] = toW(sx, sy);
            mover(arrastre.n, wx - arrastre.n.x, wy - arrastre.n.y);
            estado.current.miniBase = null;
          } else if (!arrastre.n) {
            const v = estado.current.vista;
            v.x = arrastre.vx - (sx - arrastre.sx) / v.k;
            v.y = arrastre.vy - (sy - arrastre.sy) / v.k;
          }
          pedirDibujo();
          return;
        }
        if (e.target !== cv) return;
        const n = golpe(sx, sy);
        if (n !== estado.current.hover) {
          estado.current.hover = n;
          cv.style.cursor = n ? "pointer" : "grab";
          pedirDibujo();
        }
      };
      const arriba = () => {
        if (arrastre && !movio)
          props$.current.onSeleccionar(arrastre.n?.id ?? null);
        arrastre = null;
        cv.style.cursor = "grab";
      };
      const salir = () => {
        if (!estado.current.hover) return;
        estado.current.hover = null;
        pedirDibujo();
      };
      const rueda = (e: WheelEvent) => {
        e.preventDefault();
        const [sx, sy] = pos(e);
        const [wx, wy] = toW(sx, sy);
        const v = estado.current.vista;
        const { W, H } = estado.current;
        const k = Math.min(
          4,
          Math.max(0.03, v.k * Math.exp(-e.deltaY * 0.0015)),
        );
        v.k = k;
        v.x = wx - (sx - W / 2) / k;
        v.y = wy - (sy - H / 2) / k;
        pedirDibujo();
      };
      cv.addEventListener("mousedown", abajo);
      window.addEventListener("mousemove", alMover);
      window.addEventListener("mouseup", arriba);
      cv.addEventListener("mouseleave", salir);
      cv.addEventListener("wheel", rueda, { passive: false });
      return () => {
        cv.removeEventListener("mousedown", abajo);
        window.removeEventListener("mousemove", alMover);
        window.removeEventListener("mouseup", arriba);
        cv.removeEventListener("mouseleave", salir);
        cv.removeEventListener("wheel", rueda);
      };
    }, []);

    return (
      <>
        <canvas
          ref={lienzo}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            cursor: "grab",
          }}
        />
        <canvas
          ref={mini}
          width={360}
          height={232}
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            width: 180,
            height: 116,
            background: colores(props.oscuro).mini,
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: 8,
          }}
        />
      </>
    );
  },
);

function redondeo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
