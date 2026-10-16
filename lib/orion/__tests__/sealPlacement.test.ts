import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { pickSealPlacement, stampSynerlinkWatermark } from '../stampSynerlinkWatermark';

const W = 612;
const H = 792;

function sealRect(p: { cx: number; cy: number; radius: number }) {
  return { x0: p.cx - p.radius, y0: p.cy - p.radius, x1: p.cx + p.radius, y1: p.cy + p.radius };
}

function intersects(a: ReturnType<typeof sealRect>, b: ReturnType<typeof sealRect>) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

describe('pickSealPlacement', () => {
  it('sin cajas usa la esquina inferior derecha', () => {
    const p = pickSealPlacement(W, H, []);
    expect(p.cx).toBeGreaterThan(W / 2);
    expect(p.cy).toBeLessThan(H / 2);
  });

  it('esquiva el validador ubicado en la esquina inferior derecha', () => {
    const validator = { x0: 380, y0: 20, x1: 600, y1: 220 };
    const p = pickSealPlacement(W, H, [validator]);
    expect(intersects(sealRect(p), validator)).toBe(false);
  });

  it('esquiva firmas y validadores repartidos en el pie de página', () => {
    const boxes = [
      { x0: 20, y0: 20, x1: 200, y1: 150 },
      { x0: 220, y0: 20, x1: 400, y1: 150 },
      { x0: 420, y0: 20, x1: 600, y1: 150 },
    ];
    const p = pickSealPlacement(W, H, boxes);
    for (const b of boxes) expect(intersects(sealRect(p), b)).toBe(false);
  });
});

describe('stampSynerlinkWatermark', () => {
  it('estampa con cajas en % sin fallar', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([W, H]);
    const out = await stampSynerlinkWatermark(await pdf.save(), [
      { page: 0, x: 60, y: 70, width: 35, height: 25 },
    ]);
    expect(out.byteLength).toBeGreaterThan(0);
  });
});
