import { describe, expect, it } from 'vitest';
import {
  CATALOGO,
  CATEGORIAS_EDITOR,
  MAX_CONFIG_JSON,
  PALETAS,
  agentAvatarNotionUrl,
  composeAvatarSvg,
  composePartThumbSvg,
  configDesdeSemilla,
  etiquetaOpcion,
  isNotionAvatarUrl,
  notionAvatarVersion,
  opcionesLorelei,
  parseAvatarConfig,
  randomAvatarConfig,
  serializeAvatarConfig,
  sugerenciaParaAgente,
  userAvatarUrl,
} from '../compose';

const base = () => configDesdeSemilla('prueba');

describe('catálogo desde el esquema de Lorelei', () => {
  it('trae las partes de la versión instalada', () => {
    expect(CATALOGO.hair.length).toBeGreaterThanOrEqual(48);
    expect(CATALOGO.eyes.length).toBeGreaterThanOrEqual(24);
    expect(CATALOGO.mouth).toContain('happy01');
    expect(CATALOGO.mouth).toContain('sad01');
    expect(CATALOGO.hairAccessories).toEqual(['flowers']);
    // Ordenado: variant01 primero.
    expect(CATALOGO.hair[0]).toBe('variant01');
  });

  it('el editor tiene una categoría por parte y por color, sin repetir', () => {
    const ids = CATEGORIAS_EDITOR.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['hair', 'eyes', 'mouth', 'glasses', 'beard', 'hairColor', 'skinColor', 'backgroundColor']));
    expect(CATEGORIAS_EDITOR.find((c) => c.id === 'glasses')!.opciones[0]).toBeNull();
    expect(etiquetaOpcion('mouth', 'sad03')).toBe('Seria 3');
    expect(etiquetaOpcion('hair', 'variant07')).toBe('Cabello 7');
    expect(etiquetaOpcion('glasses', null)).toBe('Ninguno');
  });
});

describe('parseAvatarConfig', () => {
  it('acepta una configuración válida (objeto o texto) y la devuelve limpia', () => {
    const c = base();
    expect(parseAvatarConfig(c)).toEqual(c);
    expect(parseAvatarConfig(serializeAvatarConfig(c))).toEqual(c);
  });

  it('cabe holgado en la columna NVARCHAR(1000)', () => {
    const c = { ...base(), seed: 'x'.repeat(64), glasses: 'variant01', beard: 'variant01', earrings: 'variant01', freckles: 'variant01', hairAccessories: 'flowers' };
    expect(serializeAvatarConfig(c).length).toBeLessThan(MAX_CONFIG_JSON / 2);
  });

  it.each([
    ['versión 1 (motor de piezas anterior)', { v: 1, tipo: 'persona', partes: {}, fondo: 0 }],
    ['estilo desconocido', { estilo: 'avataaars' }],
    ['clave desconocida', { extra: '<script>' }],
    ['variante inexistente', { hair: 'variant999' }],
    ['variante como número', { eyes: 3 }],
    ['parte fija vacía', { mouth: null }],
    ['opcional inexistente', { glasses: 'variant99' }],
    ['color con #', { hairColor: '#000000' }],
    ['color con inyección', { skinColor: 'fff" onload="x' }],
    ['transparente fuera del fondo', { hairColor: 'transparent' }],
    ['flip no booleano', { flip: 'si' }],
    ['semilla larga', { seed: 'x'.repeat(65) }],
  ])('rechaza: %s', (_n, cambios) => {
    expect(parseAvatarConfig({ ...base(), ...cambios })).toBeNull();
  });

  it('rechaza JSON roto, nulos, arreglos y textos demasiado largos', () => {
    expect(parseAvatarConfig('{no es json')).toBeNull();
    expect(parseAvatarConfig(null)).toBeNull();
    expect(parseAvatarConfig([1, 2])).toBeNull();
    expect(parseAvatarConfig('x'.repeat(5000))).toBeNull();
  });

  it('el fondo admite transparente', () => {
    expect(parseAvatarConfig({ ...base(), backgroundColor: 'transparent' })).not.toBeNull();
  });
});

describe('configDesdeSemilla / sugerencias', () => {
  it('es determinista: misma semilla, mismo avatar', () => {
    expect(configDesdeSemilla('Orión')).toEqual(configDesdeSemilla('Orión'));
    expect(composeAvatarSvg(configDesdeSemilla('Vega'))).toBe(composeAvatarSvg(configDesdeSemilla('Vega')));
  });

  it('semillas distintas dan avatares distintos', () => {
    const svgs = ['Atlas', 'Galileo', 'Kepler', 'Mercurio', 'Orión', 'Sirio', 'Vega'].map((n) =>
      serializeAvatarConfig({ ...sugerenciaParaAgente(n), seed: '' })
    );
    expect(new Set(svgs).size).toBe(svgs.length);
  });

  it('siempre da una configuración válida y en blanco y negro por defecto', () => {
    for (let i = 0; i < 30; i += 1) {
      const c = randomAvatarConfig();
      expect(parseAvatarConfig(c)).toEqual(c);
      expect(c.hairColor).toBe('000000');
      expect(c.skinColor).toBe('ffffff');
    }
  });

  it('el aleatorio conserva los colores pedidos', () => {
    const c = randomAvatarConfig({ hairColor: PALETAS.hairColor[3].color, backgroundColor: 'transparent' });
    expect(c.hairColor).toBe(PALETAS.hairColor[3].color);
    expect(c.backgroundColor).toBe('transparent');
  });

  it('lo que elige DiceBear con la semilla es lo mismo que se dibuja con las opciones explícitas', async () => {
    const { createAvatar } = await import('@dicebear/core');
    const lorelei = await import('@dicebear/lorelei');
    const c = configDesdeSemilla('Kepler');
    const porSemilla = createAvatar(lorelei, { seed: 'Kepler', backgroundColor: ['f2f2f2'] }).toString();
    expect(composeAvatarSvg(c)).toBe(porSemilla);
  });
});

describe('composeAvatarSvg (createAvatar de DiceBear)', () => {
  it('produce un SVG de Lorelei con su atribución CC0', () => {
    const svg = composeAvatarSvg(base());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Lisa Wischofsky');
    expect(svg).toContain('creativecommons.org/publicdomain/zero/1.0');
    expect(svg).not.toMatch(/<script|on[a-z]+=|href=/i);
  });

  it('escapa el título y respeta el tamaño', () => {
    const svg = composeAvatarSvg(base(), { size: 64, title: '<b>Ana & "Luis"</b>' });
    expect(svg).toContain('<title>&lt;b&gt;Ana &amp; &quot;Luis&quot;&lt;/b&gt;</title>');
    expect(svg).toContain('width="64"');
  });

  it('cada opción opcional aparece o desaparece según la configuración', () => {
    const sin = { ...base(), glasses: null };
    const con = { ...base(), glasses: CATALOGO.glasses[0] };
    expect(opcionesLorelei(sin).glassesProbability).toBe(0);
    expect(opcionesLorelei(con).glassesProbability).toBe(100);
    expect(composeAvatarSvg(con)).not.toBe(composeAvatarSvg(sin));
  });

  it('flip y fondo cambian el dibujo', () => {
    const c = base();
    expect(composeAvatarSvg({ ...c, flip: true })).not.toBe(composeAvatarSvg(c));
    expect(composeAvatarSvg({ ...c, backgroundColor: 'b6e3f4' })).toContain('#b6e3f4');
  });

  it('la miniatura recorta el lienzo a la zona de la parte', () => {
    const svg = composePartThumbSvg(base(), 'eyes', CATALOGO.eyes[0]);
    expect(svg).not.toContain('viewBox="0 0 980 980"');
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
