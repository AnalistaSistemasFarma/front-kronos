import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_BYTES_STICKER,
  errorArchivoSticker,
  leerWebp,
  limpiarNombreSticker,
  textoEstadoPropuesta,
} from '../stickers-personales-reglas';

/*
 * «Mis stickers» (2026-10-21) — reglas puras: el archivo se valida por sus
 * BYTES (WebP estático o animado), no por la extensión ni el tipo del navegador.
 */
const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- archivos versionados del repositorio.
const leer = (p: string) => new Uint8Array(readFileSync(path.join(raiz, p)));

/** WebP mínimo de mentira con el fragmento dado (solo cabecera; sirve para leer el tamaño). */
function webpFalso(fragmento: 'VP8 ' | 'VP8L', ancho: number, alto: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  const tam = b.length - 8;
  b.set([tam & 0xff, (tam >> 8) & 0xff, 0, 0], 4);
  b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  b.set([...fragmento].map((c) => c.charCodeAt(0)), 12);
  if (fragmento === 'VP8 ') {
    b.set([0x9d, 0x01, 0x2a], 23);
    b.set([ancho & 0xff, (ancho >> 8) & 0x3f, alto & 0xff, (alto >> 8) & 0x3f], 26);
  } else {
    b[20] = 0x2f;
    const v = (ancho - 1) | ((alto - 1) << 14);
    b.set([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff], 21);
  }
  return b;
}

describe('leerWebp', () => {
  it('reconoce un WebP ANIMADO y uno estático (VP8X) de verdad', () => {
    expect(leerWebp(leer('public/chat/stickers/noto/listo.webp'))).toEqual({ ancho: 160, alto: 160, animado: true });
    expect(leerWebp(leer('public/chat/stickers/noto/listo.poster.webp'))).toEqual({ ancho: 160, alto: 160, animado: false });
  });

  it('lee los lados de los WebP simples (con y sin pérdida)', () => {
    expect(leerWebp(webpFalso('VP8 ', 512, 400))).toEqual({ ancho: 512, alto: 400, animado: false });
    expect(leerWebp(webpFalso('VP8L', 300, 256))).toEqual({ ancho: 300, alto: 256, animado: false });
  });

  it('rechaza lo que no es WebP aunque se llame .webp: SVG, PNG, GIF o un RIFF con tamaño falso', () => {
    expect(leerWebp(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(leerWebp(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]))).toBeNull();
    expect(leerWebp(new TextEncoder().encode('GIF89a'.padEnd(64, '\0')))).toBeNull();
    const mentiroso = webpFalso('VP8 ', 512, 512);
    mentiroso[4] = 0xff;
    expect(leerWebp(mentiroso)).toBeNull();
  });
});

describe('errorArchivoSticker', () => {
  it('acepta un WebP animado o estático dentro de los topes', () => {
    expect(errorArchivoSticker(leer('public/chat/stickers/noto/aplausos.webp'))).toBeNull();
    expect(errorArchivoSticker(webpFalso('VP8L', 512, 512))).toBeNull();
  });

  it('explica cada rechazo en español', () => {
    expect(errorArchivoSticker(new Uint8Array())).toMatch(/vacío/);
    expect(errorArchivoSticker(new Uint8Array(MAX_BYTES_STICKER + 1))).toMatch(/512 KB/);
    expect(errorArchivoSticker(new TextEncoder().encode('x'.repeat(100)))).toMatch(/WebP/);
    expect(errorArchivoSticker(webpFalso('VP8 ', 32, 32))).toMatch(/pequeño/);
    expect(errorArchivoSticker(webpFalso('VP8L', 2000, 2000))).toMatch(/grande/);
  });
});

describe('nombre y estado', () => {
  it('el nombre no puede romper el «[Sticker: …]» ni el Markdown', () => {
    expect(limpiarNombreSticker('  ¡Buen [trabajo]*  equipo!\n')).toBe('¡Buen trabajo equipo!');
    expect(limpiarNombreSticker('   ')).toBeNull();
    expect(limpiarNombreSticker(5)).toBeNull();
    expect(limpiarNombreSticker('a'.repeat(200))?.length).toBe(60);
  });

  it('textos del estado de la propuesta', () => {
    expect(textoEstadoPropuesta('propuesto')).toBe('Propuesto a la empresa');
    expect(textoEstadoPropuesta('aprobado')).toBe('Aprobado por la empresa');
    expect(textoEstadoPropuesta('rechazado')).toBe('No aprobado');
    expect(textoEstadoPropuesta(null)).toBeNull();
  });
});
