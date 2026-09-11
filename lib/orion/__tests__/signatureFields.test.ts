import { describe, expect, it } from 'vitest';
import {
  clampFieldSize,
  fieldFromRect,
  parseEmbedTokenFromUrl,
  toOrionSignatureFields,
} from '../signatureFields';

describe('signatureFields', () => {
  it('clamp respeta límites Orion con width/height reales', () => {
    const clamped = clampFieldSize({
      id: 'sf-1',
      documentId: 'doc-1',
      signerOrder: 1,
      page: 1,
      x: 90,
      y: 90,
      width: 60,
      height: 40,
    });
    expect(clamped.width).toBeLessThanOrEqual(55);
    expect(clamped.height).toBeLessThanOrEqual(36);
    expect(clamped.x).toBeLessThanOrEqual(100 - clamped.width);
    expect(clamped.y).toBeLessThanOrEqual(100 - clamped.height);
  });

  it('fieldFromRect calcula porcentajes desde DOMRect', () => {
    const pageRect = { left: 0, top: 0, width: 1000, height: 2000 } as DOMRect;
    const fieldRect = { left: 100, top: 1500, width: 360, height: 320 } as DOMRect;
    const field = fieldFromRect({
      pageRect,
      fieldRect,
      signerOrder: 1,
      page: 2,
      documentId: 'doc-1',
    });
    expect(field.x).toBe(10);
    expect(field.y).toBe(75);
    expect(field.width).toBe(36);
    expect(field.height).toBe(16);
  });

  it('toOrionSignatureFields omite documentId', () => {
    const payload = toOrionSignatureFields([
      {
        id: 'sf-1',
        documentId: 'doc-1',
        signerOrder: 1,
        page: 1,
        x: 8,
        y: 78,
        width: 36,
        height: 16,
      },
    ]);
    expect(payload[0]).toEqual({
      id: 'sf-1',
      signerOrder: 1,
      page: 1,
      x: 8,
      y: 78,
      width: 36,
      height: 16,
    });
    expect('documentId' in (payload[0] as object)).toBe(false);
  });

  it('parseEmbedTokenFromUrl extrae token', () => {
    expect(
      parseEmbedTokenFromUrl('http://localhost:3000/embed/document?docId=abc&token=secret123')
    ).toBe('secret123');
  });
});
