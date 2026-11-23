/**
 * Coordenadas de firma/sello cuando el PDF tiene /Rotate.
 *
 * El editor (pdf.js) muestra la página ya girada: los % son sobre ese tamaño
 * visual (origen arriba-izquierda). pdf-lib estampa en la media box sin girar:
 * hay que traducir el recuadro y rotar el dibujo para que coincida con lo que
 * se ve al ubicar la firma.
 */

export type PageRotate = 0 | 90 | 180 | 270;

export type DrawImageBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Grados en sentido antihorario para `drawImage({ rotate: degrees(...) })`. */
  rotate: PageRotate;
};

export function normalizePageRotate(angle: number): PageRotate {
  const a = ((Math.round(Number(angle) || 0) % 360) + 360) % 360;
  if (a === 90 || a === 180 || a === 270) return a;
  return 0;
}

/** Tamaño de página como la muestra pdf.js (con /Rotate aplicado). */
export function viewedPageSize(mediaW: number, mediaH: number, rotate: number) {
  const r = normalizePageRotate(rotate);
  if (r === 90 || r === 270) return { width: mediaH, height: mediaW };
  return { width: mediaW, height: mediaH };
}

/**
 * Recuadro en % visual (origen arriba-izquierda, como SynerLink/pdf.js) →
 * parámetros de `page.drawImage` en la media box (origen abajo-izquierda).
 *
 * El sello se encaja con contain y se ancla abajo-izquierda del recuadro
 * (misma convención que Orion `computeStampDrawBox`).
 */
export function viewedPctToDrawImage(input: {
  x: number;
  y: number;
  width: number;
  height: number;
  mediaW: number;
  mediaH: number;
  pageRotate: number;
  /** Alto / ancho de la imagen a estampar. */
  stampAspect: number;
  fillRatio?: number;
}): DrawImageBox {
  const r = normalizePageRotate(input.pageRotate);
  const { width: vw, height: vh } = viewedPageSize(input.mediaW, input.mediaH, r);
  const fill = input.fillRatio ?? 0.98;

  const fieldW = Math.max(1, (input.width / 100) * vw);
  const fieldH = Math.max(1, (input.height / 100) * vh);
  const fieldLeft = (input.x / 100) * vw;
  const fieldTop = (input.y / 100) * vh;
  const fieldBottom = vh - fieldTop - fieldH;

  const aspect = Math.max(0.05, input.stampAspect);
  let stampW = fieldW * fill;
  let stampH = stampW * aspect;
  if (stampH > fieldH * fill) {
    stampH = fieldH * fill;
    stampW = stampH / aspect;
  }
  stampW = Math.max(1, Math.min(stampW, fieldW));
  stampH = Math.max(1, Math.min(stampH, fieldH));

  return visualBlToDrawImage(
    fieldLeft,
    fieldBottom,
    stampW,
    stampH,
    input.mediaW,
    input.mediaH,
    r
  );
}

/**
 * Caja visual en puntos (origen abajo-izquierda) → drawImage con rotación.
 * `rotate` de la página es el /Rotate del PDF (giro horario al visualizar).
 */
export function visualBlToDrawImage(
  left: number,
  bottom: number,
  w: number,
  h: number,
  mediaW: number,
  mediaH: number,
  pageRotate: number
): DrawImageBox {
  const r = normalizePageRotate(pageRotate);
  switch (r) {
    case 90:
      // drawImage rota antihorario alrededor de (x,y); con 90° el ancla queda
      // en la esquina que, tras el /Rotate 90 del visor, es abajo-izquierda visual.
      return { x: mediaW - bottom, y: left, width: w, height: h, rotate: 90 };
    case 180:
      return {
        x: mediaW - left,
        y: mediaH - bottom,
        width: w,
        height: h,
        rotate: 180,
      };
    case 270:
      return { x: bottom, y: mediaH - left, width: w, height: h, rotate: 270 };
    default:
      return { x: left, y: bottom, width: w, height: h, rotate: 0 };
  }
}

/** Punto en coords visuales (origen abajo-izquierda) → media box. */
export function mapVisualBlPoint(
  vx: number,
  vy: number,
  mediaW: number,
  mediaH: number,
  pageRotate: number
): { x: number; y: number } {
  const r = normalizePageRotate(pageRotate);
  switch (r) {
    case 90:
      return { x: mediaW - vy, y: vx };
    case 180:
      return { x: mediaW - vx, y: mediaH - vy };
    case 270:
      return { x: vy, y: mediaH - vx };
    default:
      return { x: vx, y: vy };
  }
}

/**
 * Solo la caja en media (AABB), sin rotar el dibujo — útil para hit-tests.
 * Para estampar imágenes/texto legibles usar `viewedPctToDrawImage`.
 */
export function viewedPctToMediaAabb(input: {
  x: number;
  y: number;
  width: number;
  height: number;
  mediaW: number;
  mediaH: number;
  pageRotate: number;
}): { x: number; y: number; width: number; height: number } {
  const r = normalizePageRotate(input.pageRotate);
  const { width: vw, height: vh } = viewedPageSize(input.mediaW, input.mediaH, r);
  const left = (input.x / 100) * vw;
  const top = (input.y / 100) * vh;
  const boxW = Math.max(1, (input.width / 100) * vw);
  const boxH = Math.max(1, (input.height / 100) * vh);
  const bottom = vh - top - boxH;
  const right = left + boxW;
  const topBl = bottom + boxH;

  const map = (vx: number, vy: number) => {
    switch (r) {
      case 90:
        return { x: input.mediaW - vy, y: vx };
      case 180:
        return { x: input.mediaW - vx, y: input.mediaH - vy };
      case 270:
        return { x: vy, y: input.mediaH - vx };
      default:
        return { x: vx, y: vy };
    }
  };

  const corners = [
    map(left, bottom),
    map(right, bottom),
    map(left, topBl),
    map(right, topBl),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}
