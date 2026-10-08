import { describe, expect, it } from 'vitest';
import { Avatar, Style } from '@dicebear/core';
import loreleiDef from '@dicebear/styles/lorelei.json';
import {
  BOCAS_ASISTENTE,
  CATALOGO,
  MAX_CONFIG_JSON,
  PALETAS,
  agentAvatarNotionUrl,
  avatarDataUri,
  categoriasEditor,
  composeAvatarSvg,
  configDesdeSemilla,
  etiquetaOpcion,
  isNotionAvatarUrl,
  notionAvatarVersion,
  opcionesLorelei,
  parseAvatarConfig,
  randomAvatarConfig,
  serializeAvatarConfig,
  sugerenciaParaAgente,
  thumbDataUri,
  userAvatarUrl,
} from '../compose';

const base = () => configDesdeSemilla('prueba');
const OLP = ['Atlas', 'Galileo', 'Kepler', 'Mercurio', 'Orión', 'Sirio', 'Vega'];

describe('catálogo desde la definición de Lorelei (DiceBear 10)', () => {
  it('trae exactamente las opciones de Lorelei', () => {
    expect(CATALOGO.hair).toHaveLength(48);
    expect(CATALOGO.eyes).toHaveLength(24);
    expect(CATALOGO.eyebrows).toHaveLength(13);
    expect(CATALOGO.mouth).toHaveLength(27);
    expect(CATALOGO.nose).toHaveLength(6);
    expect(CATALOGO.head).toHaveLength(4);
    expect(CATALOGO.glasses).toHaveLength(5);
    expect(CATALOGO.earrings).toHaveLength(3);
    expect(CATALOGO.beard).toHaveLength(2);
    expect(CATALOGO.freckles).toHaveLength(1);
    expect(CATALOGO.hairAccessories).toEqual(['flowers']);
    expect(CATALOGO.hair[0]).toBe('variant01');
  });

  it('el editor expone una categoría por opción, sin repetir; los asistentes solo ven bocas happy*', () => {
    const ids = categoriasEditor('user').map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'hair', 'head', 'eyes', 'eyebrows', 'mouth', 'nose', 'glasses', 'earrings', 'beard', 'freckles',
      'hairAccessories', 'hairColor', 'skinColor', 'backgroundColor', 'flip',
    ]);
    expect(categoriasEditor('user').find((c) => c.id === 'mouth')!.opciones).toHaveLength(27);
    const bocasAgente = categoriasEditor('agent').find((c) => c.id === 'mouth')!.opciones;
    expect(bocasAgente).toHaveLength(18);
    expect(bocasAgente.every((b) => b!.startsWith('happy'))).toBe(true);
    expect(categoriasEditor().find((c) => c.id === 'glasses')!.opciones[0]).toBeNull();
    expect(etiquetaOpcion('mouth', 'sad03')).toBe('Seria 3');
    expect(etiquetaOpcion('hair', 'variant07')).toBe('Cabello 7');
    expect(etiquetaOpcion('flip', 'horizontal')).toBe('Horizontal');
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
    ['versión 1 (motor de piezas)', { v: 1, tipo: 'persona', partes: {}, fondo: 0 }],
    ['versión 2 (DiceBear 9)', { v: 2 }],
    ['tipo animal', { tipo: 'animal' }],
    ['estilo desconocido', { estilo: 'avataaars' }],
    ['clave desconocida', { extra: '<script>' }],
    ['variante inexistente', { hair: 'variant999' }],
    ['variante como número', { eyes: 3 }],
    ['parte fija vacía', { mouth: null }],
    ['opcional inexistente', { glasses: 'variant99' }],
    ['color con #', { hairColor: '#000000' }],
    ['color con inyección', { skinColor: 'fff" onload="x' }],
    ['transparente fuera del fondo', { hairColor: 'transparent' }],
    ['flip booleano', { flip: true }],
    ['flip desconocido', { flip: 'diagonal' }],
    ['semilla larga', { seed: 'x'.repeat(65) }],
  ])('rechaza: %s', (_n, cambios) => {
    expect(parseAvatarConfig({ ...base(), ...cambios })).toBeNull();
  });

  it('un asistente no puede tener boca seria; una persona sí', () => {
    const seria = { ...base(), mouth: 'sad01' };
    expect(parseAvatarConfig(seria, 'user')).not.toBeNull();
    expect(parseAvatarConfig(seria, 'agent')).toBeNull();
    expect(parseAvatarConfig({ ...base(), mouth: 'happy04' }, 'agent')).not.toBeNull();
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

describe('semillas, aleatorio y asistentes', () => {
  it('es determinista: misma semilla, mismo avatar', () => {
    expect(configDesdeSemilla('Orión')).toEqual(configDesdeSemilla('Orión'));
    expect(composeAvatarSvg(configDesdeSemilla('Vega'))).toBe(composeAvatarSvg(configDesdeSemilla('Vega')));
  });

  it('asistentes de OLP: semilla = nombre, boca sonriente, todos distintos y válidos', () => {
    const configs = OLP.map((n) => sugerenciaParaAgente(n));
    configs.forEach((c, i) => {
      expect(c.seed).toBe(OLP[i]);
      expect(BOCAS_ASISTENTE).toContain(c.mouth);
      expect(parseAvatarConfig(c, 'agent')).toEqual(c);
    });
    expect(new Set(configs.map((c) => serializeAvatarConfig({ ...c, seed: '' }))).size).toBe(OLP.length);
  });

  it('el aleatorio de asistente nunca da boca seria', () => {
    for (let i = 0; i < 60; i += 1) expect(randomAvatarConfig({}, 'agent').mouth.startsWith('happy')).toBe(true);
  });

  it('siempre da una configuración válida y en blanco y negro por defecto', () => {
    for (let i = 0; i < 30; i += 1) {
      const c = randomAvatarConfig();
      expect(parseAvatarConfig(c)).toEqual(c);
      expect(c.hairColor).toBe('000000');
      expect(c.skinColor).toBe('ffffff');
      expect(c.flip).toBe('none');
    }
  });

  it('el aleatorio conserva los colores pedidos', () => {
    const c = randomAvatarConfig({ hairColor: PALETAS.hairColor[3].color, backgroundColor: 'transparent' });
    expect(c.hairColor).toBe(PALETAS.hairColor[3].color);
    expect(c.backgroundColor).toBe('transparent');
  });

  it('lo que elige DiceBear con la semilla es lo mismo que se dibuja con las opciones explícitas', () => {
    const style = new Style(loreleiDef as ConstructorParameters<typeof Style>[0]);
    const c = configDesdeSemilla('Kepler');
    const porSemilla = new Avatar(style, { seed: 'Kepler', hairColor: '000000', skinColor: 'ffffff', backgroundColor: 'f2f2f2' }).toString();
    expect(composeAvatarSvg(c)).toBe(porSemilla);
  });
});

describe('composeAvatarSvg / data URI (new Avatar de DiceBear 10)', () => {
  it('produce un SVG de Lorelei con su atribución CC0 y sin nada ejecutable', () => {
    const svg = composeAvatarSvg(base());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Lisa Wischofsky');
    expect(svg).toContain('creativecommons.org/publicdomain/zero/1.0');
    expect(svg).not.toMatch(/<script|<foreignObject|\son[a-z]+=/i);
    // DiceBear 10 reutiliza piezas con <use href="#…">: solo referencias internas.
    expect(svg.match(/href="[^"]*"/g)?.every((h) => h.startsWith('href="#'))).toBe(true);
  });

  it('el data URI es lo que pinta el <img> del editor', () => {
    expect(avatarDataUri(base()).startsWith('data:image/svg+xml')).toBe(true);
    expect(thumbDataUri(base(), 'eyes', CATALOGO.eyes[0])).toContain(encodeURIComponent('viewBox="360 380 360 200"'));
  });

  it('escapa el título y respeta el tamaño', () => {
    const svg = composeAvatarSvg(base(), { size: 64, title: '<b>Ana & "Luis"</b>' });
    expect(svg).not.toContain('<b>Ana');
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
    expect(composeAvatarSvg({ ...c, flip: 'horizontal' })).not.toBe(composeAvatarSvg(c));
    expect(composeAvatarSvg({ ...c, backgroundColor: 'b6e3f4' }).toLowerCase()).toContain('b6e3f4');
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
