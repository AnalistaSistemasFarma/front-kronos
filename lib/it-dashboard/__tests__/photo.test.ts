import { describe, expect, it } from 'vitest';
import { parsePhotoDataUrl } from '../photo';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('parsePhotoDataUrl', () => {
  it('accepts real JPEG and PNG and uses the sniffed type', () => {
    const a = parsePhotoDataUrl(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    expect(a.ok && a.mime).toBe('image/jpeg');
    // Declared as JPEG but it is a PNG: the real type wins.
    const b = parsePhotoDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`);
    expect(b.ok && b.mime).toBe('image/png');
  });

  it('rejects other formats, renamed files, empty and too big', () => {
    expect(parsePhotoDataUrl('data:image/svg+xml;base64,PHN2Zz4=').ok).toBe(false);
    expect(parsePhotoDataUrl(`data:image/png;base64,${Buffer.from('<html>').toString('base64')}`).ok).toBe(false);
    expect(parsePhotoDataUrl('data:image/png;base64,').ok).toBe(false);
    expect(parsePhotoDataUrl(null).ok).toBe(false);
    const big = Buffer.concat([jpeg, Buffer.alloc(1_600_000)]);
    const r = parsePhotoDataUrl(`data:image/jpeg;base64,${big.toString('base64')}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pesada/);
  });
});
