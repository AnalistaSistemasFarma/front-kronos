import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATEGORIAS_EMOJI,
  MAX_REACCIONES_POR_PERSONA,
  REACCIONES_RAPIDAS,
  buscarEmojis,
  esReaccionPermitida,
} from '../reactions-catalog';
import {
  alternarReaccion,
  cuerpoDescriptivo,
  describirQuienes,
  limpiarTituloGif,
  MAX_NOMBRES_REACCION,
  resumirReacciones,
  type FilaReaccion,
} from '../media-rules';
import { STICKERS_GSS, stickerGss, urlStickerGss } from '../stickers-catalog';

/*
 * Reacciones, GIF y stickers del chat (2026-10-20) — reglas puras que
 * comparten el navegador y el servidor.
 */

describe('catálogo de reacciones', () => {
  it('el set rápido pedido por Nicolás está completo, en orden, y se acepta', () => {
    expect([...REACCIONES_RAPIDAS]).toEqual(['👍', '❤️', '😂', '😮', '😢', '🙏', '✅']);
    for (const e of REACCIONES_RAPIDAS) expect(esReaccionPermitida(e)).toBe(true);
  });

  it('solo acepta emojis del catálogo, tal cual', () => {
    expect(esReaccionPermitida('🎉')).toBe(true);
    expect(esReaccionPermitida('hola')).toBe(false);
    expect(esReaccionPermitida('<img src=x>')).toBe(false);
    expect(esReaccionPermitida('👍👍')).toBe(false);
    expect(esReaccionPermitida('')).toBe(false);
    expect(esReaccionPermitida(null)).toBe(false);
    expect(esReaccionPermitida(1)).toBe(false);
    // ❤ sin el selector de variación NO es el ❤️ del catálogo.
    expect(esReaccionPermitida('❤')).toBe(false);
  });

  it('ningún emoji pasa del ancho de la columna (NVARCHAR(32)) y no hay vacíos', () => {
    for (const c of CATEGORIAS_EMOJI) {
      for (const x of c.emojis) {
        expect(x.e.length).toBeGreaterThan(0);
        expect(x.e.length).toBeLessThanOrEqual(32);
        expect(x.n.trim().length).toBeGreaterThan(0);
      }
    }
    expect(MAX_REACCIONES_POR_PERSONA).toBeGreaterThan(0);
  });

  it('busca en español, sin importar tildes ni mayúsculas', () => {
    expect(buscarEmojis('corazon').map((x) => x.e)).toContain('❤️');
    expect(buscarEmojis('GRACIAS').map((x) => x.e)).toContain('🙏');
    expect(buscarEmojis('')).toEqual([]);
    expect(buscarEmojis('zzzzqqq')).toEqual([]);
    // Sin repetidos aunque el emoji esté en dos categorías.
    const r = buscarEmojis('pulgar').map((x) => x.e);
    expect(new Set(r).size).toBe(r.length);
  });
});

const fila = (id: number, id_message: number, id_user: string, emoji: string, nombre = id_user): FilaReaccion => ({
  id,
  id_message,
  id_user,
  emoji,
  nombre,
});

describe('resumen de reacciones', () => {
  it('agrupa por mensaje y emoji, en orden de llegada, y marca las mías', () => {
    const r = resumirReacciones(
      [fila(3, 10, 'b', '👍', 'Beto'), fila(1, 10, 'a', '😂', 'Ana'), fila(2, 10, 'yo', '👍', 'Yo'), fila(4, 11, 'a', '✅', 'Ana')],
      'yo'
    );
    expect(r.get(10)!.map((x) => x.emoji)).toEqual(['😂', '👍']);
    const pulgar = r.get(10)!.find((x) => x.emoji === '👍')!;
    expect(pulgar).toMatchObject({ count: 2, mine: true });
    expect(pulgar.users.map((u) => u.name)).toEqual(['Yo', 'Beto']);
    expect(r.get(11)![0]).toMatchObject({ emoji: '✅', count: 1, mine: false });
  });

  it('no manda más nombres de la cuenta (el resto es «y N más»)', () => {
    const muchas = Array.from({ length: MAX_NOMBRES_REACCION + 5 }, (_, i) => fila(i + 1, 1, `u${i}`, '🎉', `P${i}`));
    const r = resumirReacciones(muchas, 'nadie').get(1)![0];
    expect(r.count).toBe(MAX_NOMBRES_REACCION + 5);
    expect(r.users).toHaveLength(MAX_NOMBRES_REACCION);
    expect(describirQuienes(r)).toMatch(/ y 5 más$/);
  });

  it('describe quiénes reaccionaron en español', () => {
    const base = { emoji: '👍', mine: false };
    expect(describirQuienes({ ...base, count: 1, users: [{ id: 'a', name: 'Ana' }] })).toBe('Ana');
    expect(describirQuienes({ ...base, count: 2, users: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Luis' }] })).toBe('Ana y Luis');
    expect(
      describirQuienes({ ...base, count: 3, users: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Luis' }, { id: 'c', name: 'Eva' }] })
    ).toBe('Ana, Luis y Eva');
  });

  it('alterna MI reacción de forma optimista: pone, suma y quita', () => {
    const yo = { id: 'yo', name: 'Usted' };
    const una = alternarReaccion(undefined, '👍', yo);
    expect(una).toEqual([{ emoji: '👍', count: 1, mine: true, users: [yo] }]);
    const ajena = [{ emoji: '👍', count: 1, mine: false, users: [{ id: 'a', name: 'Ana' }] }];
    expect(alternarReaccion(ajena, '👍', yo)[0]).toMatchObject({ count: 2, mine: true });
    // Quitar la única deja la lista sin ese chip.
    expect(alternarReaccion(una, '👍', yo)).toEqual([]);
    // No muta la lista de entrada (React).
    expect(ajena[0].count).toBe(1);
  });
});

describe('texto descriptivo de GIF y stickers', () => {
  it('limpia el título de GIPHY', () => {
    expect(limpiarTituloGif('Happy Dance GIF by Disney')).toBe('Happy Dance');
    expect(limpiarTituloGif('Thank You GIF')).toBe('Thank You');
    expect(limpiarTituloGif('**[raro]** `x` <b>')).toBe('raro x b');
    expect(limpiarTituloGif('')).toBe('GIF animado');
    expect(limpiarTituloGif(null)).toBe('GIF animado');
    expect(limpiarTituloGif('a'.repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it('el cuerpo es lo que leen agentes y conectores: [GIF: …] o [Sticker: …], sin corchetes internos', () => {
    expect(cuerpoDescriptivo('sticker', '¡De acuerdo!')).toBe('[Sticker: ¡De acuerdo!]');
    expect(cuerpoDescriptivo('gif', 'gato [bailando]')).toBe('[GIF: gato bailando]');
    expect(cuerpoDescriptivo('gif', '')).toBe('[GIF: GIF animado]');
  });
});

describe('paquete propio de stickers', () => {
  const raiz = path.resolve(__dirname, '../../..');

  it('cada sticker tiene su archivo SVG propio, sin scripts ni referencias externas', () => {
    expect(STICKERS_GSS.length).toBeGreaterThanOrEqual(12);
    for (const s of STICKERS_GSS) {
      expect(s.code).toMatch(/^[a-z0-9-]+$/);
      const archivo = path.join(raiz, 'public', urlStickerGss(s.code));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta del catálogo versionado.
      expect(existsSync(archivo), archivo).toBe(true);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta del catálogo versionado.
      const svg = readFileSync(archivo, 'utf8');
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(svg).not.toMatch(/<script|on[a-z]+=|xlink:href|href=|<image|<foreignObject/i);
      expect(svg).toContain(`aria-label="${s.label}"`);
    }
  });

  it('códigos únicos y búsqueda por código', () => {
    expect(new Set(STICKERS_GSS.map((s) => s.code)).size).toBe(STICKERS_GSS.length);
    expect(stickerGss('pulgar-arriba')?.label).toBe('¡De acuerdo!');
    expect(stickerGss('no-existe')).toBeNull();
    expect(stickerGss(5)).toBeNull();
  });
});
