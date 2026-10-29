"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

/**
 * Lienzo del mapa de memorias (vista gráfica tipo Obsidian), sin dependencias:
 * canvas 2D + una simulación de fuerzas con rejilla espacial (sirve para unos
 * miles de nodos). Recibe el grafo ya armado; la página decide qué es cada
 * grupo (empresa en el mapa general, tema en el personal).
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
  /** h = jerarquía; own = agente→memoria; mm = entre memorias del mismo grupo; x = entre grupos. */
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
  vecinos: Sim[];
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
    tenue: "rgba(26,29,33,.03)",
    cruce: "rgba(26,29,33,.16)",
    lazo: "rgba(26,29,33,.09)",
    tinta: "#1a1d21",
    tinta2: "#343a40",
    halo: "rgba(255,255,255,.95)",
    relleno: "#ffffff",
    mini: "rgba(255,255,255,.92)",
  },
  oscuro: {
    fondo: "#28292e",
    punto: "rgba(255,255,255,.06)",
    tenue: "rgba(255,255,255,.03)",
    cruce: "rgba(255,255,255,.2)",
    lazo: "rgba(255,255,255,.1)",
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

const FUENTE = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

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

function disponer(
  nodos: Sim[],
  enlaces: { s: Sim; t: Sim; k: EnlaceMapa["k"] }[],
  grupos: GrupoMapa[],
) {
  const rnd = aleatorio(nodos.length * 31 + enlaces.length);
  // Anclas de los grupos: el más grande al centro, los demás en anillo.
  const tam = new Map<string, number>();
  for (const n of nodos) tam.set(n.grupo, (tam.get(n.grupo) ?? 0) + 1);
  const orden = [...grupos].sort(
    (a, b) => (tam.get(b.id) ?? 0) - (tam.get(a.id) ?? 0),
  );
  const anclas = new Map<string, { x: number; y: number }>();
  const radio = 650 + Math.sqrt(nodos.length) * 22;
  orden.forEach((g, i) => {
    if (i === 0 && orden.length > 2) return anclas.set(g.id, { x: 0, y: 0 });
    const j = orden.length > 2 ? i - 1 : i;
    const total = orden.length > 2 ? orden.length - 1 : orden.length;
    const a = (j / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
    anclas.set(g.id, {
      x: Math.cos(a) * radio * 1.25,
      y: Math.sin(a) * radio * 0.85,
    });
  });
  for (const n of nodos) {
    const a = anclas.get(n.grupo) ?? { x: 0, y: 0 };
    const r =
      n.tipo === "grupo"
        ? 0
        : n.tipo === "depto"
          ? 120
          : n.tipo === "agente"
            ? 200
            : 260;
    const ang = rnd() * Math.PI * 2;
    n.x = a.x + Math.cos(ang) * r * rnd();
    n.y = a.y + Math.sin(ang) * r * rnd();
  }
  const L = { h: 170, own: 80, mm: 90, x: 420 };
  const S = { h: 0.06, own: 0.1, mm: 0.02, x: 0.003 };
  const carga = (n: Sim) =>
    n.tipo === "grupo"
      ? -9000
      : n.tipo === "depto"
        ? -5000
        : n.tipo === "agente"
          ? -4200
          : -420;
  const CELDA = 260;
  const ITER = nodos.length > 1500 ? 220 : 320;
  for (let it = 0; it < ITER; it++) {
    const alfa = 1 - it / ITER;
    const rejilla = new Map<string, Sim[]>();
    for (const n of nodos) {
      const k = `${Math.floor(n.x / CELDA)},${Math.floor(n.y / CELDA)}`;
      const c = rejilla.get(k);
      if (c) c.push(n);
      else rejilla.set(k, [n]);
    }
    for (const a of nodos) {
      const cx = Math.floor(a.x / CELDA);
      const cy = Math.floor(a.y / CELDA);
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const c = rejilla.get(`${cx + dx},${cy + dy}`);
          if (!c) continue;
          for (const b of c) {
            if (b === a) continue;
            let ex = b.x - a.x;
            let ey = b.y - a.y;
            let d2 = ex * ex + ey * ey;
            if (d2 < 1) {
              ex = rnd() - 0.5;
              ey = rnd() - 0.5;
              d2 = 1;
            }
            const d = Math.sqrt(d2);
            // carga negativa: empuja a «a» lejos de «b» (el par se visita dos veces, una por nodo).
            const f = ((carga(a) + carga(b)) / 2 / d2) * alfa * 0.5;
            a.vx += (ex / d) * f;
            a.vy += (ey / d) * f;
          }
        }
    }
    for (const l of enlaces) {
      const ex = l.t.x - l.s.x;
      const ey = l.t.y - l.s.y;
      const d = Math.sqrt(ex * ex + ey * ey) || 1;
      const k = ((d - L[l.k]) / d) * S[l.k] * alfa;
      l.s.vx += ex * k;
      l.s.vy += ey * k;
      l.t.vx -= ex * k;
      l.t.vy -= ey * k;
    }
    for (const n of nodos) {
      const a = anclas.get(n.grupo);
      if (a) {
        const g = n.tipo === "grupo" ? 0.08 : 0.0035;
        n.vx += (a.x - n.x) * g * alfa;
        n.vy += (a.y - n.y) * g * alfa;
      }
      n.vx *= 0.55;
      n.vy *= 0.55;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
}

export const MapaMemorias = forwardRef<MapaMemoriasHandle, Props>(
  function MapaMemorias(props, ref) {
    const {
      nodos,
      enlaces,
      grupos,
      visible,
      resaltados,
      seleccionado,
      mostrarZonas,
      onSeleccionar,
      version,
    } = props;
    const lienzo = useRef<HTMLCanvasElement>(null);
    const mini = useRef<HTMLCanvasElement>(null);
    const estado = useRef({
      sim: [] as Sim[],
      porId: new Map<string, Sim>(),
      lazos: [] as { s: Sim; t: Sim; k: EnlaceMapa["k"] }[],
      vista: { x: 0, y: 0, k: 0.4 },
      W: 0,
      H: 0,
      hover: null as Sim | null,
    });
    const props$ = useRef(props);
    props$.current = props;

    // ── Construir y disponer cuando cambia el grafo ──
    useEffect(() => {
      const sim: Sim[] = nodos.map((n) => ({
        ...n,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        vecinos: [],
      }));
      const porId = new Map(sim.map((n) => [n.id, n]));
      const lazos: { s: Sim; t: Sim; k: EnlaceMapa["k"] }[] = [];
      for (const e of enlaces) {
        const s = porId.get(e.s);
        const t = porId.get(e.t);
        if (!s || !t || s === t) continue;
        lazos.push({ s, t, k: e.k });
        s.vecinos.push(t);
        t.vecinos.push(s);
      }
      disponer(sim, lazos, grupos);
      estado.current.sim = sim;
      estado.current.porId = porId;
      estado.current.lazos = lazos;
      estado.current.hover = null;
      medir();
      ajustar();
    }, [nodos, enlaces, grupos]);

    const radio = (n: Sim) =>
      n.tipo === "grupo"
        ? 26
        : n.tipo === "depto"
          ? 10
          : n.tipo === "agente"
            ? 15
            : 3.4 + Math.min(6, n.vecinos.length * 0.9);
    const escala = () =>
      Math.max(0.6, Math.min(1.5, estado.current.vista.k * 1.6));

    const toS = (x: number, y: number): [number, number] => {
      const { vista: v, W, H } = estado.current;
      return [(x - v.x) * v.k + W / 2, (y - v.y) * v.k + H / 2];
    };
    const toW = (sx: number, sy: number): [number, number] => {
      const { vista: v, W, H } = estado.current;
      return [(sx - W / 2) / v.k + v.x, (sy - H / 2) / v.k + v.y];
    };

    const dibujar = useCallback(() => {
      const cv = lienzo.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const { sim, lazos, vista, W, H, hover } = estado.current;
      const {
        visible: vis,
        resaltados: q,
        seleccionado: selId,
        mostrarZonas: zonas,
        grupos: gs,
        oscuro,
      } = props$.current;
      const T = oscuro ? TEMAS.oscuro : TEMAS.claro;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = T.fondo;
      ctx.fillRect(0, 0, W, H);
      const paso = 32 * vista.k;
      if (paso > 8) {
        ctx.fillStyle = T.punto;
        const [ox, oy] = toS(0, 0);
        const sx = ((ox % paso) + paso) % paso;
        const sy = ((oy % paso) + paso) % paso;
        for (let x = sx; x < W; x += paso)
          for (let y = sy; y < H; y += paso) ctx.fillRect(x, y, 1.3, 1.3);
      }
      const sel = selId ? (estado.current.porId.get(selId) ?? null) : null;
      const foco = hover ?? sel;
      const vec = foco ? new Set<Sim>([foco, ...foco.vecinos]) : null;
      const esVis = (n: Sim) => vis(n);

      if (zonas)
        for (const g of gs) {
          const ns = sim.filter((n) => n.grupo === g.id && esVis(n));
          if (!ns.length) continue;
          let cx = 0;
          let cy = 0;
          for (const n of ns) {
            cx += n.x;
            cy += n.y;
          }
          cx /= ns.length;
          cy /= ns.length;
          const ds = ns
            .map((n) => Math.hypot(n.x - cx, n.y - cy))
            .sort((a, b) => a - b);
          const r = (ds[Math.floor(ds.length * 0.92)] ?? 80) + 70;
          const [sx, sy] = toS(cx, cy);
          const sr = r * vista.k;
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
          const bx = sx - tw / 2;
          const by = sy - sr - 10;
          ctx.globalAlpha = dim;
          ctx.fillStyle = T.relleno;
          redondeo(ctx, bx, by, tw, 20, 10);
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

      for (const l of lazos) {
        if (!esVis(l.s) || !esVis(l.t)) continue;
        const [x1, y1] = toS(l.s.x, l.s.y);
        const [x2, y2] = toS(l.t.x, l.t.y);
        let col: string;
        let w = 1;
        if (vec) {
          if (l.s === foco || l.t === foco) {
            col = hexA(foco!.color, 0.8);
            w = 1.6;
          } else col = T.tenue;
        } else if (l.k === "x") col = T.cruce;
        else if (l.k === "h") {
          col = hexA(l.s.color, 0.5);
          w = 1.5;
        } else col = T.lazo;
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        if (l.k === "x" && !vec) {
          const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15;
          const my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(mx, my, x2, y2);
        } else {
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }

      const esc = escala();
      for (const tipo of [
        "memoria",
        "depto",
        "agente",
        "grupo",
      ] as TipoNodo[]) {
        for (const n of sim) {
          if (n.tipo !== tipo || !esVis(n)) continue;
          const [x, y] = toS(n.x, n.y);
          const r = radio(n) * esc;
          if (x < -120 || y < -80 || x > W + 120 || y > H + 80) continue;
          let a = 1;
          if (vec && !vec.has(n)) a = 0.16;
          if (q && !q.has(n.id)) a = Math.min(a, 0.16);
          ctx.globalAlpha = a;
          if (n.tipo === "memoria") {
            ctx.fillStyle = n.color;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            if (n === sel || q?.has(n.id)) {
              ctx.strokeStyle = T.tinta;
              ctx.lineWidth = 1.6;
              ctx.stroke();
            }
          } else if (n.tipo === "depto") {
            ctx.fillStyle = T.relleno;
            ctx.strokeStyle = n.color;
            ctx.lineWidth = 2;
            redondeo(ctx, x - r, y - r, r * 2, r * 2, r * 0.4);
            ctx.fill();
            ctx.stroke();
          } else if (n.tipo === "agente") {
            ctx.shadowColor = "rgba(0,0,0,.12)";
            ctx.shadowBlur = 6;
            ctx.shadowOffsetY = 1;
            ctx.fillStyle = T.relleno;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
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
            ctx.shadowColor = hexA(n.color, 0.35);
            ctx.shadowBlur = 14;
            ctx.fillStyle = n.color;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = T.fondo;
            ctx.lineWidth = 3;
            ctx.stroke();
          }
          let rotulo =
            (n.tipo === "grupo" && !zonas) ||
            (n.tipo === "agente" && vista.k > 0.3) ||
            (n.tipo === "depto" && vista.k > 0.42) ||
            (n.tipo === "memoria" &&
              (vec ? vec.has(n) : q ? q.has(n.id) : vista.k > 1.5));
          if (vec && vec.has(n) && n.tipo === "agente") rotulo = true;
          if (vec && !vec.has(n) && n.tipo !== "grupo") rotulo = false;
          if (rotulo) {
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
            if (vec && foco && n !== foco && n.tipo === "memoria") {
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
              if (ctx.textAlign === "center")
                ty += Math.sin(an) > 0 ? fs * 0.6 : -fs * 0.3;
            }
            ctx.lineWidth = 4;
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
          ctx.globalAlpha = 1;
        }
      }
      dibujarMini();
    }, []);

    function limites(): [number, number, number, number] {
      let a = 1e9;
      let b = 1e9;
      let c = -1e9;
      let d = -1e9;
      for (const n of estado.current.sim) {
        if (!props$.current.visible(n)) continue;
        a = Math.min(a, n.x);
        b = Math.min(b, n.y);
        c = Math.max(c, n.x);
        d = Math.max(d, n.y);
      }
      if (a > c) return [-100, -100, 100, 100];
      return [a, b, c, d];
    }

    function dibujarMini() {
      const mc = mini.current;
      if (!mc) return;
      const mx = mc.getContext("2d");
      if (!mx) return;
      const [a, b, c, d] = limites();
      const pad = 60;
      const w = c - a + pad * 2;
      const h = d - b + pad * 2;
      const s = Math.min(360 / w, 232 / h);
      const ox = (360 - w * s) / 2;
      const oy = (232 - h * s) / 2;
      mx.clearRect(0, 0, 360, 232);
      for (const n of estado.current.sim) {
        if (!props$.current.visible(n)) continue;
        mx.fillStyle = hexA(n.color, n.tipo === "memoria" ? 0.75 : 1);
        const r = n.tipo === "memoria" ? 1.8 : n.tipo === "grupo" ? 5 : 3;
        mx.beginPath();
        mx.arc(
          ox + (n.x - a + pad) * s,
          oy + (n.y - b + pad) * s,
          r,
          0,
          Math.PI * 2,
        );
        mx.fill();
      }
      const [wx1, wy1] = toW(0, 0);
      const [wx2, wy2] = toW(estado.current.W, estado.current.H);
      mx.strokeStyle = "#228be6";
      mx.lineWidth = 2;
      mx.strokeRect(
        ox + (wx1 - a + pad) * s,
        oy + (wy1 - b + pad) * s,
        (wx2 - wx1) * s,
        (wy2 - wy1) * s,
      );
    }

    function medir() {
      const cv = lienzo.current;
      if (!cv) return;
      const r = cv.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      estado.current.W = r.width;
      estado.current.H = r.height;
      cv.width = r.width * dpr;
      cv.height = r.height * dpr;
    }

    function ajustar() {
      const [a, b, c, d] = limites();
      const v = estado.current.vista;
      const { W, H } = estado.current;
      v.x = (a + c) / 2;
      v.y = (b + d) / 2 + 30;
      v.k = Math.max(
        0.05,
        Math.min(1.6, Math.min(W / (c - a + 420), (H - 60) / (d - b + 480))),
      );
      dibujar();
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
        a = Math.min(a, n.x);
        b = Math.min(b, n.y);
        c = Math.max(c, n.x);
        d = Math.max(d, n.y);
      }
      const v = estado.current.vista;
      const { W, H } = estado.current;
      v.x = (a + c) / 2;
      v.y = (b + d) / 2;
      v.k = Math.max(
        0.05,
        Math.min(
          1.8,
          Math.min((W - 80) / (c - a + 700), (H - 120) / (d - b + 700)),
        ),
      );
      dibujar();
    }

    useImperativeHandle(ref, () => ({
      acercar: () => {
        estado.current.vista.k = Math.min(4, estado.current.vista.k * 1.3);
        dibujar();
      },
      alejar: () => {
        estado.current.vista.k = Math.max(0.05, estado.current.vista.k / 1.3);
        dibujar();
      },
      ajustar,
      enfocar,
    }));

    // Redibujar cuando cambian filtros, selección o zonas.
    useEffect(() => {
      dibujar();
    }, [
      visible,
      resaltados,
      seleccionado,
      mostrarZonas,
      props.oscuro,
      dibujar,
    ]);

    // Tamaño (ventana y pantalla completa).
    useEffect(() => {
      const alCambiar = () => {
        medir();
        dibujar();
      };
      alCambiar();
      const ro = new ResizeObserver(alCambiar);
      if (lienzo.current) ro.observe(lienzo.current);
      return () => ro.disconnect();
    }, [version]);

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
          if (!props$.current.visible(n)) continue;
          const r = (radio(n) * escala()) / k + 3 / k;
          const d = Math.hypot(n.x - wx, n.y - wy);
          if (d < r && d < md) {
            md = d;
            mejor = n;
          }
        }
        return mejor;
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
      const mover = (e: MouseEvent) => {
        const [sx, sy] = pos(e);
        if (arrastre) {
          if (Math.hypot(sx - arrastre.sx, sy - arrastre.sy) > 3) movio = true;
          if (arrastre.n) {
            const n = arrastre.n;
            const [wx, wy] = toW(sx, sy);
            const dx = wx - n.x;
            const dy = wy - n.y;
            n.x = wx;
            n.y = wy;
            if (n.tipo !== "memoria")
              for (const m of n.vecinos) {
                const arrastra =
                  m.tipo === "memoria" ||
                  (n.tipo === "grupo" && m.tipo === "depto") ||
                  (n.tipo === "depto" && m.tipo === "agente");
                if (!arrastra) continue;
                m.x += dx * 0.85;
                m.y += dy * 0.85;
                if (m.tipo !== "memoria")
                  for (const z of m.vecinos)
                    if (
                      z.tipo === "memoria" ||
                      (m.tipo === "depto" && z.tipo === "agente")
                    ) {
                      z.x += dx * 0.8;
                      z.y += dy * 0.8;
                    }
              }
          } else {
            const v = estado.current.vista;
            v.x = arrastre.vx - (sx - arrastre.sx) / v.k;
            v.y = arrastre.vy - (sy - arrastre.sy) / v.k;
          }
          dibujar();
          return;
        }
        if (e.target !== cv) return;
        const n = golpe(sx, sy);
        if (n !== estado.current.hover) {
          estado.current.hover = n;
          cv.style.cursor = n ? "pointer" : "grab";
          dibujar();
        }
      };
      const arriba = () => {
        if (arrastre && !movio)
          props$.current.onSeleccionar(arrastre.n?.id ?? null);
        arrastre = null;
        cv.style.cursor = "grab";
      };
      const salir = () => {
        estado.current.hover = null;
        dibujar();
      };
      const rueda = (e: WheelEvent) => {
        e.preventDefault();
        const [sx, sy] = pos(e);
        const [wx, wy] = toW(sx, sy);
        const v = estado.current.vista;
        const { W, H } = estado.current;
        const k = Math.min(
          4,
          Math.max(0.05, v.k * Math.exp(-e.deltaY * 0.0015)),
        );
        v.k = k;
        v.x = wx - (sx - W / 2) / k;
        v.y = wy - (sy - H / 2) / k;
        dibujar();
      };
      cv.addEventListener("mousedown", abajo);
      window.addEventListener("mousemove", mover);
      window.addEventListener("mouseup", arriba);
      cv.addEventListener("mouseleave", salir);
      cv.addEventListener("wheel", rueda, { passive: false });
      return () => {
        cv.removeEventListener("mousedown", abajo);
        window.removeEventListener("mousemove", mover);
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
            background: (props.oscuro ? TEMAS.oscuro : TEMAS.claro).mini,
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
