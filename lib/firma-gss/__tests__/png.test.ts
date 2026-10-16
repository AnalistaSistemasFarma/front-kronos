import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { codificarPng, decodificarPng, FIRMA_MAX_BYTES, FirmaImagenError, sanearFirmaPng, tieneTrazo, tipoPorBytes } from '../png';

// Saneamiento de la imagen de una firma: tipo por bytes, estructura, límites y RECODIFICACIÓN sin metadatos.

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer, badCrc = false): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((crc32(td) + (badCrc ? 1 : 0)) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function ihdr(w: number, h: number, colorType = 6, depth = 8, interlace = 0): Buffer {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0);
  d.writeUInt32BE(h, 4);
  d[8] = depth;
  d[9] = colorType;
  d[12] = interlace;
  return d;
}

/** PNG de prueba: píxeles `ch` canales por fila, filtro por fila y fragmentos extra. */
function png(opts: { w: number; h: number; ch?: number; colorType?: number; rows?: (y: number) => number[]; filtro?: (y: number) => number; extras?: Buffer[]; tras?: Buffer; idat?: Buffer; badCrc?: boolean; depth?: number; interlace?: number }): Buffer {
  const ch = opts.ch ?? 4;
  const lines: Buffer[] = [];
  let prev = Buffer.alloc(opts.w * ch);
  for (let y = 0; y < opts.h; y++) {
    const row = Buffer.from(opts.rows ? opts.rows(y) : new Array(opts.w * ch).fill(255));
    const f = opts.filtro ? opts.filtro(y) : 0;
    const out = Buffer.alloc(row.length);
    for (let x = 0; x < row.length; x++) {
      const a = x >= ch ? row[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, pr][f];
      out[x] = (row[x] - pred) & 0xff;
    }
    lines.push(Buffer.concat([Buffer.from([f]), out]));
    prev = row;
  }
  const idat = opts.idat ?? deflateSync(Buffer.concat(lines));
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr(opts.w, opts.h, opts.colorType ?? 6, opts.depth ?? 8, opts.interlace ?? 0)),
    ...(opts.extras ?? []),
    chunk('IDAT', idat, opts.badCrc),
    chunk('IEND', Buffer.alloc(0)),
    ...(opts.tras ? [opts.tras] : []),
  ]);
}

const url = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
/** Firma de prueba: fondo blanco con una diagonal negra (RGBA). */
const conTrazo = (w: number) => (y: number) => {
  const r: number[] = [];
  for (let x = 0; x < w; x++) r.push(...(x === y ? [10, 10, 10, 255] : [255, 255, 255, 255]));
  return r;
};

function err(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(FirmaImagenError);
    return (e as Error).message;
  }
  throw new Error('no lanzó');
}

describe('Firma GSS · tipo por bytes', () => {
  it('reconoce PNG y JPEG por su firma de archivo, no por la extensión', () => {
    expect(tipoPorBytes(SIG)).toBe('png');
    expect(tipoPorBytes([0xff, 0xd8, 0xff, 0xe0])).toBe('jpeg');
    expect(tipoPorBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(tipoPorBytes(Buffer.from('GIF89a'))).toBeNull();
    expect(tipoPorBytes([])).toBeNull();
  });
});

describe('Firma GSS · saneamiento y recodificación', () => {
  it('recodifica: quita metadatos (tEXt, eXIf, iTXt) y lo que venga después de IEND, y conserva los píxeles', () => {
    const original = png({
      w: 8,
      h: 8,
      rows: conTrazo(8),
      extras: [chunk('tEXt', Buffer.from('Author\0Fulano GPS 4.6,-74.0')), chunk('eXIf', Buffer.from('MM\0*ubicacion')), chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x/>'))],
      tras: Buffer.from('<script>alert(1)</script>'),
    });
    const r = sanearFirmaPng(url(original));
    const limpio = Buffer.from(r.dataUrl.split(',')[1], 'base64');
    const texto = limpio.toString('latin1');
    expect(texto).not.toContain('tEXt');
    expect(texto).not.toContain('eXIf');
    expect(texto).not.toContain('iTXt');
    expect(texto).not.toContain('Fulano');
    expect(texto).not.toContain('script');
    expect(r.width).toBe(8);
    expect(r.height).toBe(8);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Mismos píxeles que el original.
    expect(Buffer.from(decodificarPng(limpio).rgba)).toEqual(Buffer.from(decodificarPng(original).rgba));
    // Solo IHDR, IDAT e IEND.
    const tipos: string[] = [];
    for (let off = 8; off < limpio.length; ) {
      const len = limpio.readUInt32BE(off);
      tipos.push(limpio.toString('ascii', off + 4, off + 8));
      off += 12 + len;
    }
    expect(tipos).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('decodifica los 5 filtros de PNG y los tipos de color de 8 bits (RGB, gris, gris+alfa)', () => {
    const rgba = png({ w: 6, h: 5, rows: conTrazo(6), filtro: (y) => y % 5 });
    expect(Buffer.from(decodificarPng(rgba).rgba)).toEqual(Buffer.from(decodificarPng(png({ w: 6, h: 5, rows: conTrazo(6) })).rgba));
    const rgb = decodificarPng(png({ w: 2, h: 1, ch: 3, colorType: 2, rows: () => [0, 0, 0, 255, 255, 255], filtro: () => 1 }));
    expect(Array.from(rgb.rgba)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    const gris = decodificarPng(png({ w: 2, h: 1, ch: 1, colorType: 0, rows: () => [0, 200] }));
    expect(Array.from(gris.rgba)).toEqual([0, 0, 0, 255, 200, 200, 200, 255]);
    const ga = decodificarPng(png({ w: 1, h: 1, ch: 2, colorType: 4, rows: () => [30, 128] }));
    expect(Array.from(ga.rgba)).toEqual([30, 30, 30, 128]);
  });

  it('rechaza lo que no es PNG (JPEG, SVG, otro MIME) aunque diga image/png', () => {
    expect(err(() => sanearFirmaPng(`data:image/png;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]).toString('base64')}`))).toMatch(/no es una imagen PNG/);
    expect(err(() => sanearFirmaPng('data:image/svg+xml;base64,PHN2Zz4='))).toMatch(/PNG/);
    expect(err(() => sanearFirmaPng('data:image/jpeg;base64,/9j/4AAQ'))).toMatch(/PNG/);
    expect(err(() => sanearFirmaPng(''))).toMatch(/Falta/);
    expect(err(() => sanearFirmaPng(42))).toMatch(/Falta/);
  });

  it('rechaza PNG dañados: CRC, truncado, sin IHDR primero, paleta, entrelazado, 16 bits', () => {
    expect(err(() => decodificarPng(png({ w: 4, h: 4, rows: conTrazo(4), badCrc: true })))).toMatch(/CRC/);
    const ok = png({ w: 4, h: 4, rows: conTrazo(4) });
    expect(err(() => decodificarPng(ok.subarray(0, ok.length - 20)))).toMatch(/truncada|incompleta/);
    expect(err(() => decodificarPng(Buffer.concat([SIG, chunk('IDAT', Buffer.alloc(1)), chunk('IEND', Buffer.alloc(0))])))).toMatch(/no es un PNG/);
    expect(err(() => decodificarPng(png({ w: 2, h: 2, extras: [chunk('PLTE', Buffer.alloc(3))] })))).toMatch(/paleta/);
    expect(err(() => decodificarPng(png({ w: 2, h: 2, interlace: 1 })))).toMatch(/entrelazado/);
    expect(err(() => decodificarPng(png({ w: 2, h: 2, depth: 16 })))).toMatch(/no admitido/);
  });

  it('acota tamaño y dimensiones, y frena una «bomba» de descompresión', () => {
    expect(err(() => decodificarPng(png({ w: 2001, h: 1, idat: deflateSync(Buffer.alloc(10)) })))).toMatch(/2000/);
    // IDAT que se infla mucho más de lo que declara IHDR.
    expect(err(() => decodificarPng(png({ w: 2, h: 2, idat: deflateSync(Buffer.alloc(50_000_000)) })))).toMatch(/dañada|grande/);
    const grande = `data:image/png;base64,${'A'.repeat(Math.ceil((FIRMA_MAX_BYTES * 4) / 3) + 100)}`;
    expect(err(() => sanearFirmaPng(grande))).toMatch(/supera/);
  });

  it('rechaza una imagen sin trazo (en blanco o transparente)', () => {
    expect(err(() => sanearFirmaPng(url(png({ w: 4, h: 4 }))))).toMatch(/no tiene trazo/);
    expect(tieneTrazo(new Uint8Array([0, 0, 0, 0]))).toBe(false);
    expect(tieneTrazo(new Uint8Array([0, 0, 0, 255]))).toBe(true);
  });

  it('codificarPng produce un PNG que vuelve a decodificar igual', () => {
    const img = { width: 3, height: 2, rgba: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) };
    expect(decodificarPng(codificarPng(img))).toEqual(img);
  });
});
