import { describe, expect, it } from 'vitest';
import { blockingLines, canApply, lineReady, lowConfidenceIndexes, offerAiNote } from './pdfReview';

const match = (confidence: 'alta' | 'media' | 'baja' | 'ninguna', extra: Record<string, unknown> = {}) => ({
  confidence, reason: 'r', autoSelected: confidence === 'alta', confirmed: confidence === 'alta', ...extra,
});

// Farmalogica PO 11619 (simulated): three Media lines with a suggested item.
const po11619 = [
  { row: 1, ItemCode: 'PTPT0121', include: true, match: match('media') },
  { row: 2, ItemCode: 'PTCZ0121', include: true, match: match('media') },
  { row: 3, ItemCode: 'PTAM0500', include: true, match: match('media') },
];

describe('PDF offer review without per-line confirmation', () => {
  it('Media lines with a suggested item are ready: Agregar enabled right away', () => {
    expect(po11619.every(lineReady)).toBe(true);
    expect(blockingLines(po11619)).toBe(0);
    expect(canApply(po11619)).toBe(true);
  });

  it('Baja lines do not block either, they are only listed for review', () => {
    const lines = [...po11619, { row: 4, ItemCode: 'PTXX0001', include: true, match: match('baja') }, { row: 5, ItemCode: 'PTXX0002', include: false, match: match('baja') }];
    expect(canApply(lines)).toBe(true);
    expect(lowConfidenceIndexes(lines)).toEqual([3]);
  });

  it('an included line without an item still blocks until the user picks one or unchecks it', () => {
    const lines = [...po11619, { row: 4, ItemCode: '', include: true, match: match('ninguna') }];
    expect(blockingLines(lines)).toBe(1);
    expect(canApply(lines)).toBe(false);
    lines[3].include = false;
    expect(canApply(lines)).toBe(true);
  });

  it('nothing included: cannot apply', () => {
    expect(canApply(po11619.map((l) => ({ ...l, include: false })))).toBe(false);
  });

  it('the offer keeps the confidence label, or Elegido when the user picked the item', () => {
    expect(offerAiNote(match('media'))).toBe('Media: r');
    expect(offerAiNote(match('alta'))).toBe('Alta: r');
    expect(offerAiNote(match('baja', { confirmed: true }))).toBe('Elegido: r');
  });
});
