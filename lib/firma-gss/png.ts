import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { PNG_FIRMA_BYTES, tipoPorBytes } from './sniff';

export { tipoPorBytes };

/**
 * SANEAMIENTO de la imagen de una firma (servidor, sin dependencias nuevas).
 *
 * El navegador ya convierte la foto o el dibujo a PNG con un canvas (eso quita
 * el EXIF y cualquier metadato de la foto original). Aun así el servidor NO
 * confía en el cliente:
 *   1. Tamaño: data URL de hasta FIRMA_MAX_BYTES (decodificado).
 *   2. Tipo por FIRMA DIGITAL de bytes (no por la extensión ni el MIME que
 *      declare el cliente): solo PNG.
 *   3. Estructura: fragmentos con CRC válido, IHDR coherente y dimensiones
 *      acotadas; descompresión con límite (sin «bombas» de descompresión).
 *   4. RECODIFICACIÓN: se decodifican los píxeles y se escribe un PNG NUEVO
 *      solo con IHDR + IDAT + IEND. Cualquier metadato (tEXt, iTXt, zTXt,
 *      eXIf, tIME, iCCP…) o dato colado tras IEND desaparece.
 *   5. La imagen debe tener trazo (no se guarda una imagen en blanco).
 */

export const FIRMA_MAX_BYTES = 1_000_000;
export const FIRMA_MAX_LADO = 2000;

export class FirmaImagenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirmaImagenError';
  }
}

const PNG_SIG = Buffer.from(PNG_FIRMA_BYTES);

// --- CRC32 (PNG) -----------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// --- Decodificación --------------------------------------------------------
/** Canales por tipo de color admitido (8 bits): 0 gris, 2 RGB, 4 gris+alfa, 6 RGBA. */
const CANALES: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export interface PngDecodificado {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Decodifica un PNG de 8 bits no entrelazado (lo que produce un canvas) a RGBA. */
export function decodificarPng(buf: Buffer): PngDecodificado {
  if (tipoPorBytes(buf) !== 'png') throw new FirmaImagenError('El archivo no es una imagen PNG válida.');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  let fin = false;
  let primero = true;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (off + 12 + len > buf.length) throw new FirmaImagenError('La imagen está truncada.');
    const td = buf.subarray(off + 4, off + 8 + len);
    if (crc32(td) !== buf.readUInt32BE(off + 8 + len)) throw new FirmaImagenError('La imagen está dañada (CRC).');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (primero && type !== 'IHDR') throw new FirmaImagenError('La imagen no es un PNG válido.');
    primero = false;
    if (type === 'IHDR') {
      if (len !== 13) throw new FirmaImagenError('La imagen no es un PNG válido.');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0) throw new FirmaImagenError('La imagen no es un PNG válido.');
      if (data[12] !== 0) throw new FirmaImagenError('Formato de PNG no admitido (entrelazado).');
      if (depth !== 8 || !(colorType in CANALES)) throw new FirmaImagenError('Formato de PNG no admitido.');
      if (width < 1 || height < 1 || width > FIRMA_MAX_LADO || height > FIRMA_MAX_LADO) {
        throw new FirmaImagenError(`La imagen debe medir como máximo ${FIRMA_MAX_LADO} × ${FIRMA_MAX_LADO} píxeles.`);
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      fin = true;
      break;
    } else if (type === 'PLTE') {
      throw new FirmaImagenError('Formato de PNG no admitido (paleta).');
    }
    // Cualquier otro fragmento (metadatos) se ignora: no pasa al PNG nuevo.
    off += 12 + len;
  }
  if (!fin || !width || idat.length === 0) throw new FirmaImagenError('La imagen está incompleta.');

  const ch = CANALES[colorType];
  const stride = width * ch;
  const esperado = height * (stride + 1);
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: esperado + 1 });
  } catch {
    throw new FirmaImagenError('La imagen está dañada o es demasiado grande.');
  }
  if (raw.length !== esperado) throw new FirmaImagenError('La imagen está dañada.');

  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filtro = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= ch ? px[dst + x - ch] : 0;
      const b = y > 0 ? px[dst - stride + x] : 0;
      const c = x >= ch && y > 0 ? px[dst - stride + x - ch] : 0;
      let r: number;
      switch (filtro) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new FirmaImagenError('La imagen está dañada (filtro).');
      }
      px[dst + x] = r & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += ch) {
    const o = i * 4;
    if (ch === 4) { rgba[o] = px[j]; rgba[o + 1] = px[j + 1]; rgba[o + 2] = px[j + 2]; rgba[o + 3] = px[j + 3]; }
    else if (ch === 3) { rgba[o] = px[j]; rgba[o + 1] = px[j + 1]; rgba[o + 2] = px[j + 2]; rgba[o + 3] = 255; }
    else if (ch === 2) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[j]; rgba[o + 3] = px[j + 1]; }
    else { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[j]; rgba[o + 3] = 255; }
  }
  return { width, height, rgba };
}

/** Escribe un PNG NUEVO (RGBA de 8 bits) solo con IHDR, IDAT e IEND. */
export function codificarPng({ width, height, rgba }: PngDecodificado): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** ¿Hay trazo? Algún píxel visible y oscuro (no todo blanco ni transparente). */
export function tieneTrazo(rgba: Uint8Array): boolean {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 32) continue;
    const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    if (lum < 200) return true;
  }
  return false;
}

export interface FirmaSaneada {
  dataUrl: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Valida y RECODIFICA la firma recibida como data URL. Lanza FirmaImagenError
 * con un mensaje para la persona si algo no cuadra.
 */
export function sanearFirmaPng(dataUrl: unknown): FirmaSaneada {
  if (typeof dataUrl !== 'string' || !dataUrl) throw new FirmaImagenError('Falta la imagen de la firma.');
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl.trim());
  if (!m) throw new FirmaImagenError('La firma debe llegar como imagen PNG.');
  if (m[1].length > Math.ceil((FIRMA_MAX_BYTES * 4) / 3) + 4) {
    throw new FirmaImagenError(`La imagen de la firma supera ${Math.round(FIRMA_MAX_BYTES / 1000)} KB.`);
  }
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > FIRMA_MAX_BYTES) throw new FirmaImagenError(`La imagen de la firma supera ${Math.round(FIRMA_MAX_BYTES / 1000)} KB.`);
  const img = decodificarPng(buf);
  if (!tieneTrazo(img.rgba)) throw new FirmaImagenError('La imagen no tiene trazo: dibuje su firma o suba una foto clara de ella sobre fondo blanco.');
  const limpio = codificarPng(img);
  return {
    dataUrl: `data:image/png;base64,${limpio.toString('base64')}`,
    sha256: createHash('sha256').update(limpio).digest('hex'),
    width: img.width,
    height: img.height,
    bytes: limpio.length,
  };
}
