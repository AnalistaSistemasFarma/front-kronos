import { describe, expect, it } from 'vitest';
import {
  AVATAR_BACKGROUNDS,
  agentAvatarNotionUrl,
  categoriasDe,
  composeAvatarSvg,
  composePartThumbSvg,
  isNotionAvatarUrl,
  notionAvatarVersion,
  parseAvatarConfig,
  randomAvatarConfig,
  serializeAvatarConfig,
  userAvatarUrl,
} from '../compose';

describe('parseAvatarConfig', () => {
  it('acepta una configuración válida y la devuelve limpia', () => {
    const c = parseAvatarConfig({ v: 1, tipo: 'persona', partes: { cara: 2, cabello: 4 }, fondo: 3 });
    expect(c).not.toBeNull();
    expect(c!.partes.cara).toBe(2);
    expect(c!.partes.cabello).toBe(4);
    // Las categorías que faltan quedan en 0 (compatibilidad hacia adelante).
    expect(c!.partes.ojos).toBe(0);
  });

  it('acepta el JSON como texto', () => {
    const texto = JSON.stringify({ v: 1, tipo: 'animal', partes: { animal: 5 }, fondo: 0 });
    expect(parseAvatarConfig(texto)?.partes.animal).toBe(5);
  });

  it.each([
    ['versión desconocida', { v: 2, tipo: 'persona', partes: {}, fondo: 0 }],
    ['tipo desconocido', { v: 1, tipo: 'robot', partes: {}, fondo: 0 }],
    ['categoría ajena al tipo', { v: 1, tipo: 'animal', partes: { cabello: 1 }, fondo: 0 }],
    ['índice fuera del catálogo', { v: 1, tipo: 'persona', partes: { cara: 999 }, fondo: 0 }],
    ['índice negativo', { v: 1, tipo: 'persona', partes: { cara: -1 }, fondo: 0 }],
    ['índice decimal', { v: 1, tipo: 'persona', partes: { cara: 1.5 }, fondo: 0 }],
    ['índice como texto', { v: 1, tipo: 'persona', partes: { cara: '1' }, fondo: 0 }],
    ['fondo fuera de rango', { v: 1, tipo: 'persona', partes: {}, fondo: AVATAR_BACKGROUNDS.length }],
    ['partes no es objeto', { v: 1, tipo: 'persona', partes: [1, 2], fondo: 0 }],
  ])('rechaza: %s', (_n, raw) => {
    expect(parseAvatarConfig(raw)).toBeNull();
  });

  it('rechaza JSON roto, nulos y textos demasiado largos', () => {
    expect(parseAvatarConfig('{no es json')).toBeNull();
    expect(parseAvatarConfig(null)).toBeNull();
    expect(parseAvatarConfig('x'.repeat(5000))).toBeNull();
  });

  it('ida y vuelta: serializar y volver a leer da lo mismo', () => {
    for (const tipo of ['persona', 'animal'] as const) {
      const c = randomAvatarConfig(tipo);
      expect(parseAvatarConfig(serializeAvatarConfig(c))).toEqual(c);
    }
  });
});

describe('composeAvatarSvg', () => {
  it('compone todas las opciones de todas las categorías sin romper el SVG', () => {
    for (const tipo of ['persona', 'animal'] as const) {
      for (const cat of categoriasDe(tipo)) {
        cat.options.forEach((_o, i) => {
          const c = randomAvatarConfig(tipo, {}, () => 0);
          c.partes[cat.id] = i;
          const svg = composeAvatarSvg(c);
          expect(svg.startsWith('<svg')).toBe(true);
          expect(svg.endsWith('</svg>')).toBe(true);
          // Nada de scripts ni manejadores: el catálogo es solo dibujo.
          expect(svg).not.toMatch(/<script|on[a-z]+=|javascript:|href=/i);
          expect(composePartThumbSvg(tipo, cat.id, i)).toContain('viewBox');
        });
      }
    }
  });

  it('pinta el fondo cuando no es transparente y escapa el título', () => {
    const c = randomAvatarConfig('persona', { fondo: 2 });
    const svg = composeAvatarSvg(c, { size: 64, title: '<b>Ana & "Luis"</b>' });
    expect(svg).toContain('fill="#fca5a5"');
    expect(svg).toContain('width="64"');
    expect(svg).toContain('&lt;b&gt;Ana &amp; &quot;Luis&quot;&lt;/b&gt;');
    expect(composeAvatarSvg({ ...c, fondo: 0 })).not.toContain('<rect width="300"');
  });

  it('las categorías tienen claves únicas y los ids no cambian de nombre', () => {
    expect(categoriasDe('persona').map((c) => c.id)).toEqual([
      'cara', 'cabello', 'ojos', 'cejas', 'nariz', 'boca', 'ropa', 'barba', 'gafas', 'accesorios', 'detalles',
    ]);
    expect(categoriasDe('animal').map((c) => c.id)).toEqual(['animal', 'ojos', 'boca', 'ropa', 'gafas', 'accesorios']);
  });
});

describe('randomAvatarConfig', () => {
  it('siempre produce configuraciones válidas', () => {
    for (let i = 0; i < 200; i += 1) {
      const tipo = i % 2 ? 'persona' : 'animal';
      expect(parseAvatarConfig(randomAvatarConfig(tipo))).not.toBeNull();
    }
  });
});

describe('URLs del avatar', () => {
  it('reconoce las URLs propias y lee su versión', () => {
    const u = userAvatarUrl('abc123', 1700000000000);
    expect(u).toBe('/api/avatar/user/abc123?v=1700000000000');
    expect(isNotionAvatarUrl(u)).toBe(true);
    expect(notionAvatarVersion(u)).toBe(1700000000000);
    expect(notionAvatarVersion(agentAvatarNotionUrl('horus', 5))).toBe(5);
    expect(isNotionAvatarUrl('https://i.postimg.cc/x.png')).toBe(false);
    expect(notionAvatarVersion('/agents/orus.png')).toBeNull();
    expect(isNotionAvatarUrl(null)).toBe(false);
  });
});
