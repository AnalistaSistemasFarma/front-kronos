import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATRIBUCION_STICKERS_ANIMADOS,
  STICKERS_ANIMADOS,
  stickerAnimado,
  urlPosterStickerAnimado,
  urlStickerAnimado,
} from '../stickers-animados-catalog';
import { STICKERS_GSS } from '../stickers-catalog';
import { PAQUETES_PROPIOS, stickerPropio, todosLosStickersPropios } from '../stickers-paquetes';
import { cuerpoDescriptivo } from '../media-rules';

/*
 * Stickers ANIMADOS (2026-10-20): paquete Noto Emoji Animation (WebP animado,
 * CC BY 4.0) junto al paquete estático propio del #698.
 */

const raiz = path.resolve(__dirname, '../../..');
const leer = (url: string) => path.join(raiz, 'public', url);

/** ¿Es un WebP ANIMADO? (cabecera RIFF/WEBP con el fragmento VP8X y la marca de animación, o un ANIM). */
function esWebpAnimado(buf: Buffer): boolean {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return false;
  return buf.includes(Buffer.from('ANIM')) && buf.includes(Buffer.from('ANMF'));
}

describe('paquete de stickers animados', () => {
  it('trae entre 24 y 32 stickers, con códigos únicos y que no chocan con el paquete estático', () => {
    expect(STICKERS_ANIMADOS.length).toBeGreaterThanOrEqual(24);
    expect(STICKERS_ANIMADOS.length).toBeLessThanOrEqual(32);
    const codigos = STICKERS_ANIMADOS.map((s) => s.code);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const c of codigos) {
      expect(c).toMatch(/^noto-[a-z0-9-]+$/);
      expect(STICKERS_GSS.some((g) => g.code === c)).toBe(false);
    }
  });

  it('cada uno tiene su WebP animado liviano y su cuadro fijo, versionados en public/', () => {
    for (const s of STICKERS_ANIMADOS) {
      const anim = leer(urlStickerAnimado(s.code));
      const poster = leer(urlPosterStickerAnimado(s.code));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta del catálogo versionado.
      expect(existsSync(anim), anim).toBe(true);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta del catálogo versionado.
      expect(existsSync(poster), poster).toBe(true);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta del catálogo versionado.
      expect(esWebpAnimado(readFileSync(anim)), anim).toBe(true);
      // Peso para el celular: ningún animado pasa de 200 KB ni un cuadro fijo de 20 KB.
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta del catálogo versionado.
      expect(statSync(anim).size, anim).toBeLessThan(200 * 1024);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta del catálogo versionado.
      expect(statSync(poster).size, poster).toBeLessThan(20 * 1024);
    }
  });

  it('la atribución CC BY 4.0 está en el código y en los CREDITS', () => {
    expect(ATRIBUCION_STICKERS_ANIMADOS).toMatch(/Noto Emoji Animation/);
    expect(ATRIBUCION_STICKERS_ANIMADOS).toMatch(/CC BY 4\.0/);
    for (const archivo of [path.join(raiz, 'CREDITS.md'), leer('/chat/stickers/noto/CREDITS.md')]) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- archivo versionado.
      const texto = readFileSync(archivo, 'utf8');
      expect(texto).toMatch(/Noto Emoji Animation/);
      expect(texto).toMatch(/creativecommons\.org\/licenses\/by\/4\.0/);
    }
  });

  it('búsqueda por código y rutas sin escapar del directorio', () => {
    expect(stickerAnimado('noto-aplausos')?.label).toBe('¡Aplausos!');
    expect(stickerAnimado('aplausos')).toBeNull();
    expect(stickerAnimado(5)).toBeNull();
    expect(urlStickerAnimado('noto-a/../b')).toBe('/chat/stickers/noto/a%2F..%2Fb.webp');
  });
});

describe('paquetes propios', () => {
  it('resuelve el animado y el estático; el contrato con los agentes no cambia', () => {
    const a = stickerPropio('noto-listo');
    expect(a).toMatchObject({ paquete: 'animados', animated: true, src: '/chat/stickers/noto/listo.webp' });
    const g = stickerPropio('listo');
    expect(g).toMatchObject({ paquete: 'gss', animated: false, poster: null, src: '/chat/stickers/listo.svg' });
    expect(stickerPropio('no-existe')).toBeNull();
    expect(cuerpoDescriptivo('sticker', a!.label)).toBe('[Sticker: ¡Listo!]');
  });

  it('lista primero los animados y conserva el paquete estático completo', () => {
    expect(PAQUETES_PROPIOS.map((p) => p.id)).toEqual(['animados', 'gss']);
    const todos = todosLosStickersPropios();
    expect(todos.length).toBe(STICKERS_ANIMADOS.length + STICKERS_GSS.length);
    expect(todos[0].paquete).toBe('animados');
    expect(todos.filter((s) => s.paquete === 'gss').map((s) => s.code)).toEqual(STICKERS_GSS.map((s) => s.code));
  });
});
