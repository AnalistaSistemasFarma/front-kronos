import { describe, expect, it } from 'vitest';
import {
  normalizePageRotate,
  viewedPageSize,
  viewedPctToDrawImage,
  viewedPctToMediaAabb,
  visualBlToDrawImage,
} from '../pageRotation';

describe('pageRotation', () => {
  it('normaliza ángulos a 0|90|180|270', () => {
    expect(normalizePageRotate(0)).toBe(0);
    expect(normalizePageRotate(90)).toBe(90);
    expect(normalizePageRotate(-90)).toBe(270);
    expect(normalizePageRotate(450)).toBe(90);
  });

  it('intercambia tamaño visual en 90/270', () => {
    expect(viewedPageSize(612, 792, 0)).toEqual({ width: 612, height: 792 });
    expect(viewedPageSize(612, 792, 90)).toEqual({ width: 792, height: 612 });
    expect(viewedPageSize(612, 792, 270)).toEqual({ width: 792, height: 612 });
  });

  it('sin rotación coincide con la fórmula clásica top-left → PDF', () => {
    const mediaW = 612;
    const mediaH = 792;
    const field = { x: 10, y: 20, width: 24, height: 12 };
    // Aspecto = alto/ancho del campo → contain llena el recuadro.
    const box = viewedPctToDrawImage({
      ...field,
      mediaW,
      mediaH,
      pageRotate: 0,
      stampAspect: (mediaH * 0.12) / (mediaW * 0.24),
      fillRatio: 1,
    });
    expect(box.rotate).toBe(0);
    expect(box.x).toBeCloseTo(mediaW * 0.1, 5);
    expect(box.width).toBeCloseTo(mediaW * 0.24, 5);
    expect(box.height).toBeCloseTo(mediaH * 0.12, 5);
    expect(box.y).toBeCloseTo(mediaH * (1 - (20 + 12) / 100), 5);
  });

  it('con /Rotate 90 el ancla y la rotación del dibujo cuadran con el visor', () => {
    const mediaW = 612;
    const mediaH = 792;
    // Caja abajo-izquierda en la vista apaisada (pdf.js).
    const box = viewedPctToDrawImage({
      x: 5,
      y: 70,
      width: 20,
      height: 15,
      mediaW,
      mediaH,
      pageRotate: 90,
      stampAspect: 0.5,
      fillRatio: 1,
    });
    expect(box.rotate).toBe(90);
    // Vista: vw=792 vh=612; left=39.6 bottom≈91.8
    const left = 0.05 * 792;
    const fieldH = 0.15 * 612;
    const fieldTop = 0.7 * 612;
    const bottom = 612 - fieldTop - fieldH;
    expect(box.y).toBeCloseTo(left, 5);
    expect(box.x).toBeCloseTo(mediaW - bottom, 5);
  });

  it('AABB media de la página completa sigue siendo toda la media box', () => {
    const full = viewedPctToMediaAabb({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      mediaW: 612,
      mediaH: 792,
      pageRotate: 90,
    });
    expect(full.x).toBeCloseTo(0, 5);
    expect(full.y).toBeCloseTo(0, 5);
    expect(full.width).toBeCloseTo(612, 5);
    expect(full.height).toBeCloseTo(792, 5);
  });

  it('visualBlToDrawImage 180 invierte el ancla', () => {
    const d = visualBlToDrawImage(10, 20, 30, 40, 200, 300, 180);
    expect(d).toEqual({ x: 190, y: 280, width: 30, height: 40, rotate: 180 });
  });
});
