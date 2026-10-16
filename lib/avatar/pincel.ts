/**
 * PINCEL: convierte trazos (path/circle/ellipse/rect con stroke) en el mismo
 * tipo de línea que usa Lorelei 9.4.3.
 *
 * Lo que se midió en el SVG de Lorelei 9.4.3 (cabezas variant01…04, ver
 * docs/avatar-notion.md):
 *   - NO usa stroke: cada contorno es una FORMA RELLENA de negro (#000) con
 *     grosor variable, sin degradados ni transparencias (relleno plano);
 *   - los contornos van partidos en varios trazos, con pequeños huecos, y
 *     cada trazo se afina en sus puntas (extremos redondeados);
 *   - grosor típico ≈ 12 unidades del lienzo de 980 (2·área/perímetro: 9,8 a
 *     14), máximo ≈ 15 y puntas de ≈ 3.
 *
 * Aquí se imita eso: el trazo se aplana a una polilínea, se parte en las
 * esquinas (uniones redondeadas) y, si es cerrado, en 1–3 huecos; cada parte
 * se vuelve un polígono relleno cuyo ancho varía suavemente y se afina en
 * las puntas libres. Código PURO y determinista (mismo dibujo siempre).
 */

type P = [number, number];

const RAD = Math.PI / 180;
const r1 = (n: number) => Math.round(n * 10) / 10;

/* ─────────────────────────── Geometría → polilíneas ─────────────────────────── */

interface Sub {
  pts: P[];
  cerrado: boolean;
}

function arco(out: P[], x1: number, y1: number, rxIn: number, ryIn: number, phi: number, fa: number, fs: number, x2: number, y2: number) {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!rx || !ry) {
    out.push([x2, y2]);
    return;
  }
  const c = Math.cos(phi * RAD);
  const s = Math.sin(phi * RAD);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = c * dx + s * dy;
  const yp = -s * dx + c * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  let k = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) k = -k;
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2;
  const cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.min(96, Math.max(6, Math.ceil((Math.abs(dt) * Math.max(rx, ry)) / 2.5)));
  for (let i = 1; i <= n; i += 1) {
    const t = t1 + (dt * i) / n;
    out.push([cx + c * rx * Math.cos(t) - s * ry * Math.sin(t), cy + s * rx * Math.cos(t) + c * ry * Math.sin(t)]);
  }
}

/** Path (solo comandos absolutos M L C Q A Z, los que usan las figuras) → subtrazos. */
export function aplanar(d: string): Sub[] {
  // Tokens: letras de comando y números (las figuras no usan exponentes).
  const tokens = d.replace(/([A-Za-z])/g, ' $1 ').replace(/-/g, ' -').trim().split(/[\s,]+/).filter(Boolean);
  const subs: Sub[] = [];
  let actual: P[] = [];
  let cmd = '';
  let i = 0;
  let x = 0;
  let y = 0;
  const num = () => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error('[avatar] path inválido: ' + d.slice(0, 40));
    return v;
  };
  const cerrar = (cerrado: boolean) => {
    if (cerrado && actual.length > 1) {
      const [a, b] = [actual[actual.length - 1], actual[0]];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3);
      for (let k = 1; k < n; k += 1) actual.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    if (actual.length > 1) subs.push({ pts: actual, cerrado });
    actual = [];
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z]$/.test(t)) {
      if (t !== t.toUpperCase()) throw new Error('[avatar] comando relativo no soportado: ' + t);
      cmd = t;
      i += 1;
      if (cmd === 'Z') {
        cerrar(true);
        continue;
      }
    }
    if (cmd === 'M') {
      cerrar(false);
      x = num();
      y = num();
      actual = [[x, y]];
      cmd = 'L';
    } else if (cmd === 'L') {
      const [x0, y0] = [x, y];
      x = num();
      y = num();
      // Rectas densas (cada ~3 unidades): el ancho varía y se afina también a lo largo de ellas.
      const n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / 3));
      for (let k = 1; k <= n; k += 1) actual.push([x0 + ((x - x0) * k) / n, y0 + ((y - y0) * k) / n]);
    } else if (cmd === 'C' || cmd === 'Q') {
      const ctrl: number[] = [];
      for (let k = 0; k < (cmd === 'C' ? 6 : 4); k += 1) ctrl.push(num());
      const [x0, y0] = [x, y];
      [x, y] = [ctrl[ctrl.length - 2], ctrl[ctrl.length - 1]];
      const largo = Math.hypot(x - x0, y - y0) + Math.hypot(ctrl[0] - x0, ctrl[1] - y0);
      const n = Math.min(48, Math.max(4, Math.ceil(largo / 3)));
      for (let k = 1; k <= n; k += 1) {
        const u = k / n;
        const v = 1 - u;
        if (cmd === 'C')
          actual.push([
            v * v * v * x0 + 3 * v * v * u * ctrl[0] + 3 * v * u * u * ctrl[2] + u * u * u * x,
            v * v * v * y0 + 3 * v * v * u * ctrl[1] + 3 * v * u * u * ctrl[3] + u * u * u * y,
          ]);
        else actual.push([v * v * x0 + 2 * v * u * ctrl[0] + u * u * x, v * v * y0 + 2 * v * u * ctrl[1] + u * u * y]);
      }
    } else if (cmd === 'A') {
      const [rx, ry, rot, fa, fs] = [num(), num(), num(), num(), num()];
      const [x0, y0] = [x, y];
      x = num();
      y = num();
      arco(actual, x0, y0, rx, ry, rot, fa, fs, x, y);
    } else {
      throw new Error('[avatar] comando no soportado: ' + cmd);
    }
  }
  cerrar(false);
  // Cerrado de hecho (último punto = primero) y sin puntos repetidos.
  return subs.map((s) => {
    const pts = s.pts.filter((p, k) => k === 0 || Math.hypot(p[0] - s.pts[k - 1][0], p[1] - s.pts[k - 1][1]) > 0.05);
    let cerrado = s.cerrado;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (pts.length > 2 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) {
      pts.pop();
      cerrado = true;
    }
    return { pts, cerrado };
  });
}

/** Geometría de un elemento simple como path absoluto. */
export function geometria(tag: string, a: Record<string, string>): string {
  const n = (k: string) => Number(a[k] ?? 0);
  if (tag === 'path') return a.d ?? '';
  if (tag === 'circle' || tag === 'ellipse') {
    const [cx, cy] = [n('cx'), n('cy')];
    const rx = tag === 'circle' ? n('r') : n('rx');
    const ry = tag === 'circle' ? n('r') : n('ry');
    return 'M' + (cx - rx) + ' ' + cy + ' A' + rx + ' ' + ry + ' 0 1 0 ' + (cx + rx) + ' ' + cy + ' A' + rx + ' ' + ry + ' 0 1 0 ' + (cx - rx) + ' ' + cy + ' Z';
  }
  if (tag === 'rect') {
    const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
    const r = Math.min(n('rx'), w / 2, h / 2);
    if (!r) return 'M' + x + ' ' + y + ' L' + (x + w) + ' ' + y + ' L' + (x + w) + ' ' + (y + h) + ' L' + x + ' ' + (y + h) + ' Z';
    const A = (px: number, py: number) => ' A' + r + ' ' + r + ' 0 0 1 ' + px + ' ' + py;
    return (
      'M' + (x + r) + ' ' + y + ' L' + (x + w - r) + ' ' + y + A(x + w, y + r) + ' L' + (x + w) + ' ' + (y + h - r) + A(x + w - r, y + h) +
      ' L' + (x + r) + ' ' + (y + h) + A(x, y + h - r) + ' L' + x + ' ' + (y + r) + A(x + r, y) + ' Z'
    );
  }
  throw new Error('[avatar] elemento no soportado: ' + tag);
}

/* ─────────────────────────────── Pincel ─────────────────────────────── */

export interface OpcionesPincel {
  /** Ancho base (unidades del lienzo donde se dibuja). */
  ancho: number;
  /** Variación suave del ancho (0 = parejo; Lorelei ≈ 0.2). */
  variacion?: number;
  /** Partir los contornos cerrados con pequeños huecos (como Lorelei). */
  huecos?: boolean;
  /** Afinar las puntas libres. */
  puntas?: boolean;
  /** Perfil adicional del ancho a lo largo de cada subtrazo (u de 0 a 1). */
  perfil?: (u: number) => number;
  /** Semilla de la variación (para que dos trazos no ondulen igual). */
  semilla?: number;
}

const ESQUINA = 40 * RAD;

function largoAcumulado(pts: P[]): number[] {
  const s = [0];
  for (let k = 1; k < pts.length; k += 1) s.push(s[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return s;
}

function angulo(a: P, b: P, c: P): number {
  const [ux, uy] = [b[0] - a[0], b[1] - a[1]];
  const [vx, vy] = [c[0] - b[0], c[1] - b[1]];
  return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
}

/** Punto a la distancia s sobre la polilínea. */
function puntoEn(pts: P[], acum: number[], s: number): P {
  let k = 1;
  while (k < acum.length - 1 && acum[k] < s) k += 1;
  const tramo = acum[k] - acum[k - 1] || 1;
  const u = Math.min(1, Math.max(0, (s - acum[k - 1]) / tramo));
  return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * u, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * u];
}

/** Puntos de la polilínea entre s0 y s1 (incluye los extremos interpolados). */
function tramo(pts: P[], acum: number[], s0: number, s1: number): P[] {
  const out: P[] = [puntoEn(pts, acum, s0)];
  for (let k = 0; k < pts.length; k += 1) if (acum[k] > s0 + 0.05 && acum[k] < s1 - 0.05) out.push(pts[k]);
  out.push(puntoEn(pts, acum, s1));
  return out;
}

interface Pieza {
  pts: P[];
  /** Largo acumulado (en el subtrazo completo) de cada punto. */
  s: number[];
  /** Punta libre (se afina) o unión en esquina (ancho completo, redonda). */
  libreIni: boolean;
  libreFin: boolean;
}

function piezas(sub: Sub, op: OpcionesPincel, semilla: number): { piezas: Pieza[]; largo: number } {
  let pts = sub.pts;
  if (sub.cerrado) {
    // El recorrido cerrado arranca en una esquina, si la hay, para no partir esquinas por la mitad.
    const n = pts.length;
    const k = pts.findIndex((p, j) => angulo(pts[(j - 1 + n) % n], p, pts[(j + 1) % n]) > ESQUINA);
    if (k > 0) pts = [...pts.slice(k), ...pts.slice(0, k)];
    pts = [...pts, pts[0]];
  }
  const acum = largoAcumulado(pts);
  const L = acum[acum.length - 1];
  // Cortes: esquinas (s, 'esquina') y huecos (s, 'hueco', con su largo).
  const cortes: Array<{ s: number; hueco: number }> = [];
  for (let j = 1; j < pts.length - 1; j += 1) if (angulo(pts[j - 1], pts[j], pts[j + 1]) > ESQUINA) cortes.push({ s: acum[j], hueco: 0 });
  if (sub.cerrado && op.huecos && L > 110) {
    const n = Math.max(1, Math.min(3, Math.round(L / 190)));
    const g = Math.min(8, L * 0.04);
    const desfase = ((semilla % 97) / 97) * (L / n);
    for (let j = 0; j < n; j += 1) {
      let s = (desfase + (j * L) / n + L * 0.08) % L;
      // Lejos de las esquinas y de los extremos.
      if (cortes.some((c) => c.hueco === 0 && Math.abs(c.s - s) < 10) || s < 8 || s > L - 8) s = (s + 14) % L;
      if (s > 8 && s < L - 8) cortes.push({ s, hueco: g });
    }
  }
  cortes.sort((a, b) => a.s - b.s);
  const lista: Pieza[] = [];
  let ini = 0;
  // En un cerrado sin huecos ni esquinas, el inicio/fin se une redondo (sin afinar).
  const extremoLibre = !sub.cerrado || cortes.some((c) => c.hueco > 0);
  let libreIni = sub.cerrado ? false : true;
  if (sub.cerrado && cortes.length && cortes[0].hueco === 0 && cortes[0].s < 0.5) cortes.shift();
  const agregar = (s0: number, s1: number, li: boolean, lf: boolean) => {
    if (s1 - s0 < 0.6) return;
    const tp = tramo(pts, acum, s0, s1);
    const ss = largoAcumulado(tp).map((v) => v + s0);
    lista.push({ pts: tp, s: ss, libreIni: li, libreFin: lf });
  };
  for (const c of cortes) {
    agregar(ini, c.s - c.hueco / 2, libreIni, c.hueco > 0);
    ini = c.s + c.hueco / 2;
    libreIni = c.hueco > 0;
  }
  agregar(ini, L, libreIni, sub.cerrado ? false : extremoLibre);
  // Cerrado con huecos: la primera y la última pieza se tocan en el inicio (esquina o unión); se dejan redondas.
  return { piezas: lista, largo: L };
}

/** Polígono relleno (path d) de una pieza, con ancho variable y extremos redondos. */
function poligono(p: Pieza, ancho: (s: number, u: number) => number, op: OpcionesPincel): string {
  const n = p.pts.length;
  const total = p.s[n - 1] - p.s[0] || 1;
  const afinar = Math.min(11, total * (total < 30 ? 0.22 : 0.3));
  const anchos = p.pts.map((_q, k) => {
    const u = (p.s[k] - p.s[0]) / total;
    let w = ancho(p.s[k], u);
    if (op.puntas !== false) {
      const di = p.s[k] - p.s[0];
      const df = p.s[n - 1] - p.s[k];
      if (p.libreIni && di < afinar) w *= 0.35 + 0.65 * Math.sqrt(di / afinar);
      if (p.libreFin && df < afinar) w *= 0.35 + 0.65 * Math.sqrt(df / afinar);
    }
    return Math.max(0.3, w);
  });
  const tang = p.pts.map((_q, k) => {
    const a = p.pts[Math.max(0, k - 1)];
    const b = p.pts[Math.min(n - 1, k + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l] as P;
  });
  const izq: P[] = [];
  const der: P[] = [];
  p.pts.forEach((q, k) => {
    const [tx, ty] = tang[k];
    const h = anchos[k] / 2;
    izq.push([q[0] - ty * h, q[1] + tx * h]);
    der.push([q[0] + ty * h, q[1] - tx * h]);
  });
  const tapa = (q: P, t: P, h: number, sentido: 1 | -1): P[] => {
    const out: P[] = [];
    for (let j = 1; j < 6; j += 1) {
      const a = (j * Math.PI) / 6;
      // De la izquierda a la derecha pasando por la punta (sentido 1: adelante; -1: atrás).
      const nx = -t[1] * Math.cos(a) * sentido + t[0] * Math.sin(a) * sentido;
      const ny = t[0] * Math.cos(a) * sentido + t[1] * Math.sin(a) * sentido;
      out.push([q[0] + nx * h, q[1] + ny * h]);
    }
    return out;
  };
  const anillo: P[] = [
    ...izq,
    ...tapa(p.pts[n - 1], tang[n - 1], anchos[n - 1] / 2, 1),
    ...der.reverse(),
    ...tapa(p.pts[0], tang[0], anchos[0] / 2, -1),
  ];
  return 'M' + anillo.map(([a, b]) => r1(a) + ' ' + r1(b)).join(' L') + ' Z';
}

function hashTexto(t: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < t.length; k += 1) {
    h ^= t.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Trazo de pincel (path d de formas rellenas) para la geometría `d`. */
export function pincel(d: string, op: OpcionesPincel): string {
  const semilla = op.semilla ?? hashTexto(d);
  const variacion = op.variacion ?? 0.2;
  const out: string[] = [];
  aplanar(d).forEach((sub, j) => {
    const { piezas: ps, largo } = piezas(sub, op, semilla + j * 31);
    const fase = ((semilla >>> 8) % 628) / 100 + j;
    const ondas = Math.max(1, Math.round(largo / 120));
    const ancho = (s: number, u: number) =>
      op.ancho * (1 + variacion * Math.sin((2 * Math.PI * ondas * s) / Math.max(largo, 1) + fase)) * (op.perfil ? op.perfil(u) : 1);
    for (const p of ps) out.push(poligono(p, ancho, op));
  });
  return out.join(' ');
}

/* ─────────────────────── Marcado con stroke → pincel ─────────────────────── */

function atributos(texto: string): Record<string, string> {
  const a: Record<string, string> = {};
  for (const m of texto.matchAll(/([\w:-]+)="([^"]*)"/g)) a[m[1]] = m[2];
  return a;
}

/**
 * Reemplaza cada elemento con trazo (path, circle, ellipse, rect) por su
 * relleno (sin stroke) + su contorno como forma rellena de pincel. Sin
 * atributo stroke = negro (#000, como Lorelei); stroke-width 3.6 = ancho base.
 */
export function aPincel(svg: string, anchoBase: number, defecto = { stroke: '#000', ancho: 3.6 }): string {
  return svg.replace(/<(path|circle|ellipse|rect)\b([^>]*?)\/>/g, (_m, tag: string, attrs: string) => {
    const a = atributos(attrs);
    const stroke = a.stroke ?? defecto.stroke;
    const relleno = a.fill;
    const sw = Number(a['stroke-width'] ?? defecto.ancho);
    const tr = a.transform ? ' transform="' + a.transform + '"' : '';
    const limpio = attrs.replace(/\s(stroke|stroke-width)="[^"]*"/g, '');
    let out = relleno === 'none' ? '' : '<' + tag + limpio + '/>';
    if (stroke !== 'none' && sw > 0) {
      const factor = Math.min(1.25, Math.max(0.7, sw / defecto.ancho));
      out += '<path d="' + pincel(geometria(tag, a), { ancho: anchoBase * factor, huecos: true }) + '" fill="' + stroke + '"' + tr + '/>';
    }
    return out;
  });
}
