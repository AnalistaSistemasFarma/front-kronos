import { describe, expect, it } from 'vitest';
import {
  AGENT_AVATAR_KINDS,
  agentAvatarDataUri,
  agentAvatarPorDefecto,
  composeAgentAvatarSvg,
  kindDe,
  parseAgentAvatarConfig,
  serializeAgentAvatarConfig,
} from '../agente';
import { MAX_CONFIG_JSON, parseAvatarConfig, serializeAvatarConfig, sugerenciaParaAgente } from '../compose';
import {
  FIGURA_KINDS,
  carasDe,
  composeFiguraSvg,
  extrasDe,
  figuraAleatoria,
  figuraPorDefecto,
  parseFiguraConfig,
  serializeFiguraConfig,
  variantesDe,
  type FiguraConfig,
} from '../figuras';
import { categoriasFigura, conValorFigura, etiquetaFigura, thumbFiguraDataUri } from '../figuras-editor';

const OLP = ['Atlas', 'Galileo', 'Kepler', 'Mercurio', 'Orión', 'Sirio', 'Vega'];
const fig = (over: Partial<FiguraConfig> = {}): FiguraConfig => ({ ...figuraPorDefecto('animal', 'Prueba'), ...over });

describe('catálogo de figuras de asistentes', () => {
  it('trae los tipos y las variantes esperadas', () => {
    expect(AGENT_AVATAR_KINDS).toEqual(['persona', 'animal', 'planeta', 'constelacion', 'estrella', 'robot']);
    expect(variantesDe('animal')).toEqual([
      'gato', 'perro', 'zorro', 'buho', 'oso', 'conejo', 'panda', 'leon', 'pinguino', 'koala', 'mono', 'pulpo',
    ]);
    expect(variantesDe('planeta')).toHaveLength(10);
    expect(variantesDe('planeta')).toContain('saturno');
    expect(variantesDe('constelacion')).toHaveLength(12);
    expect(variantesDe('constelacion')).toEqual(expect.arrayContaining(['orion', 'lira', 'can-mayor', 'pleyades']));
    expect(variantesDe('estrella')).toEqual(['sol', 'estrella', 'destello', 'luna-creciente', 'cometa']);
    expect(variantesDe('robot')).toEqual(['clasico', 'pantalla', 'redondo', 'cubo']);
  });

  it('las caritas son sonrientes; "sin carita" solo en planetas y constelaciones', () => {
    for (const k of ['animal', 'estrella', 'robot'] as const) expect(carasDe(k)).not.toContain('ninguna');
    for (const k of ['planeta', 'constelacion'] as const) expect(carasDe(k)).toContain('ninguna');
    expect(carasDe('animal')).toEqual(['feliz', 'alegre', 'tranquilo', 'tierno', 'guino', 'curioso', 'picaro', 'gatuno']);
  });
});

describe('validación del avatar de un asistente', () => {
  it('sigue aceptando los configs v3 (persona Lorelei) ya guardados', () => {
    const persona = sugerenciaParaAgente('Orión');
    const guardado = serializeAvatarConfig(persona);
    expect(parseAgentAvatarConfig(guardado)).toEqual(persona);
    expect(kindDe(parseAgentAvatarConfig(guardado)!)).toBe('persona');
    // Y la regla de siempre: boca seria no vale en un asistente.
    expect(parseAgentAvatarConfig({ ...persona, mouth: 'sad01' })).toBeNull();
  });

  it('acepta una figura válida (objeto o texto) y la devuelve limpia', () => {
    const c = fig({ variante: 'buho', cara: 'curioso', extra: 'gafas' });
    expect(parseAgentAvatarConfig(c)).toEqual(c);
    expect(parseAgentAvatarConfig(serializeFiguraConfig(c))).toEqual(c);
    expect(kindDe(c)).toBe('animal');
  });

  it('rechaza tipos, variantes, caritas, accesorios y colores inválidos', () => {
    const c = fig();
    expect(parseAgentAvatarConfig({ ...c, kind: 'dragon' })).toBeNull();
    expect(parseAgentAvatarConfig({ ...c, kind: 'persona' })).toBeNull();
    expect(parseAgentAvatarConfig({ ...c, variante: 'saturno' })).toBeNull(); // variante de otro tipo
    expect(parseAgentAvatarConfig({ ...c, variante: '<script>' })).toBeNull();
    expect(parseAgentAvatarConfig({ ...c, cara: 'triste' })).toBeNull();
    expect(parseAgentAvatarConfig({ ...c, cara: 'ninguna' })).toBeNull(); // los animales siempre sonríen
    expect(parseAgentAvatarConfig({ ...c, extra: 'cohete' })).toBeNull(); // accesorio de planeta
    expect(parseAgentAvatarConfig({ ...c, relleno: 'red' })).toBeNull();
    expect(parseAgentAvatarConfig({ ...c, acento: '#000000' })).toBeNull();
    expect(parseAgentAvatarConfig({ ...c, relleno: 'transparent' })).toBeNull();
    expect(parseAgentAvatarConfig({ ...c, fondo: 'transparent' })).not.toBeNull();
    expect(parseAgentAvatarConfig({ ...c, extra: undefined })).toEqual({ ...c, extra: null });
    expect(parseAgentAvatarConfig({ ...c, otra: 1 })).toBeNull();
    expect(parseAgentAvatarConfig({ ...c, v: 5 })).toBeNull();
    expect(parseAgentAvatarConfig('{no es json')).toBeNull();
    expect(parseAgentAvatarConfig('x'.repeat(MAX_CONFIG_JSON + 1))).toBeNull();
    expect(parseAgentAvatarConfig(null)).toBeNull();
    expect(parseAgentAvatarConfig([c])).toBeNull();
    expect(parseFiguraConfig({ ...c, v: 3 })).toBeNull();
    expect(parseAgentAvatarConfig({ ...fig({ kind: 'planeta', variante: 'saturno', cara: 'ninguna', extra: 'lunas' }) })).not.toBeNull();
  });

  it('las personas (usuarios) NO aceptan figuras', () => {
    expect(parseAvatarConfig(fig(), 'user')).toBeNull();
    expect(parseAvatarConfig(serializeFiguraConfig(fig()), 'user')).toBeNull();
  });

  it('cabe holgado en la columna NVARCHAR(1000)', () => {
    for (const kind of FIGURA_KINDS) {
      const largo = Math.max(...variantesDe(kind).map((v) => v.length));
      const variante = variantesDe(kind).find((v) => v.length === largo)!;
      const extra = [...extrasDe(kind)].sort((a, b) => b.length - a.length)[0];
      const json = serializeAgentAvatarConfig({ ...figuraPorDefecto(kind, 'x'), variante, extra, fondo: 'transparent' });
      expect(json.length).toBeLessThan(MAX_CONFIG_JSON / 4);
    }
  });
});

describe('figura por defecto (determinista por el nombre)', () => {
  it('el mismo nombre da siempre la misma figura', () => {
    for (const n of OLP) for (const k of AGENT_AVATAR_KINDS) expect(agentAvatarPorDefecto(k, n)).toEqual(agentAvatarPorDefecto(k, n));
    expect(figuraPorDefecto('animal', 'Orión')).toEqual(figuraPorDefecto('animal', 'orion'));
  });

  it('los asistentes de OLP arrancan con lo suyo', () => {
    expect(figuraPorDefecto('constelacion', 'Orión').variante).toBe('orion');
    expect(figuraPorDefecto('constelacion', 'Vega').variante).toBe('lira');
    expect(figuraPorDefecto('constelacion', 'Sirio').variante).toBe('can-mayor');
    expect(figuraPorDefecto('constelacion', 'Atlas').variante).toBe('pleyades');
    expect(figuraPorDefecto('planeta', 'Mercurio').variante).toBe('mercurio');
    expect(figuraPorDefecto('planeta', 'Galileo').variante).toBe('jupiter');
    expect(figuraPorDefecto('planeta', 'Kepler').variante).toBe('marte');
    expect(kindDe(agentAvatarPorDefecto('persona', 'Vega'))).toBe('persona');
  });

  it('por defecto es blanco y negro, sin accesorio y válida', () => {
    for (const n of OLP)
      for (const k of FIGURA_KINDS) {
        const c = figuraPorDefecto(k, n);
        expect(c).toMatchObject({ relleno: 'ffffff', acento: '000000', fondo: 'f2f2f2', extra: null });
        expect(parseFiguraConfig(c)).toEqual(c);
      }
  });

  it('el aleatorio siempre es válido y conserva los colores', () => {
    let i = 0;
    const rnd = () => ((i += 0.137) % 1);
    for (let n = 0; n < 40; n += 1)
      for (const k of FIGURA_KINDS) {
        const c = figuraAleatoria(k, { relleno: 'b6e3f4', acento: '2c1b8f', fondo: 'ffffff' }, rnd);
        expect(parseFiguraConfig(c)).toEqual(c);
        expect(c).toMatchObject({ relleno: 'b6e3f4', acento: '2c1b8f', fondo: 'ffffff' });
      }
  });
});

describe('render de las figuras', () => {
  it('toda combinación de tipo, variante, carita y accesorio da un SVG limpio', () => {
    for (const kind of FIGURA_KINDS)
      for (const variante of variantesDe(kind))
        for (const cara of carasDe(kind))
          for (const extra of [null, ...extrasDe(kind)]) {
            const svg = composeFiguraSvg({ ...figuraPorDefecto(kind, 'x'), variante, cara, extra });
            expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"')).toBe(true);
            expect(svg.endsWith('</svg>')).toBe(true);
            expect(svg).not.toMatch(/%[RATUOB]|undefined|NaN|null/);
            expect(svg).not.toMatch(/<script|on\w+=/i);
            expect(svg.split('<g').length).toBe(svg.split('</g>').length);
          }
  });

  it('por defecto solo usa blanco, negro y el gris del fondo', () => {
    for (const kind of FIGURA_KINDS)
      for (const variante of variantesDe(kind)) {
        const svg = composeFiguraSvg({ ...figuraPorDefecto(kind, 'x'), variante });
        const colores = new Set(svg.match(/#[0-9a-f]{3,6}\b/gi));
        for (const c of colores) expect(['#000', '#fff', '#000000', '#ffffff', '#f2f2f2']).toContain(c.toLowerCase());
      }
  });

  it('aplica los colores elegidos y la tinta de la carita contrasta con el relleno', () => {
    const svg = composeFiguraSvg(fig({ variante: 'oso', relleno: 'b6e3f4', acento: '2c1b8f', fondo: 'ffd5dc' }));
    expect(svg).toContain('#b6e3f4');
    expect(svg).toContain('#2c1b8f');
    expect(svg).toContain('fill="#ffd5dc"');
    const noche = composeFiguraSvg({ ...figuraPorDefecto('constelacion', 'Orión'), relleno: '000000', acento: 'ffffff' });
    expect(noche).toContain('stroke="#fff"'); // la carita de la estrella, en blanco sobre el cielo negro
    expect(composeFiguraSvg(fig({ fondo: 'transparent' }))).not.toContain('<rect width="300"');
  });

  it('el título se escapa y el data: URI sirve para <img>', () => {
    const c = fig();
    expect(composeAgentAvatarSvg(c, { title: '<b>"Kepler"</b>' })).toContain('<title>&lt;b&gt;&quot;Kepler&quot;&lt;/b&gt;</title>');
    expect(agentAvatarDataUri(c).startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(composeAgentAvatarSvg(c, { size: 64 })).toContain('width="64" height="64"');
    // Una persona sigue saliendo por DiceBear Lorelei.
    expect(composeAgentAvatarSvg(sugerenciaParaAgente('Vega'))).toContain('Lorelei');
  });
});

describe('editor de figuras', () => {
  it('categorías, etiquetas, cambios y miniaturas', () => {
    const c = figuraPorDefecto('planeta', 'Kepler');
    expect(categoriasFigura('planeta').map((x) => x.id)).toEqual(['variante', 'cara', 'extra', 'relleno', 'acento', 'fondo']);
    expect(categoriasFigura('planeta').find((x) => x.id === 'extra')!.opciones[0]).toBeNull();
    expect(etiquetaFigura(c, 'variante', 'saturno')).toBe('Saturno');
    expect(etiquetaFigura(c, 'cara', 'guino')).toBe('Guiño');
    expect(etiquetaFigura(c, 'extra', null)).toBe('Ninguno');
    expect(etiquetaFigura(c, 'relleno', 'b6e3f4')).toBe('Azul cielo');
    expect(conValorFigura(c, 'extra', 'anillo').extra).toBe('anillo');
    expect(conValorFigura(c, 'variante', 'luna').variante).toBe('luna');
    for (const cat of categoriasFigura('planeta'))
      for (const v of cat.opciones) expect(thumbFiguraDataUri(c, cat.id, v).startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(thumbFiguraDataUri(c, 'cara', 'alegre'))).not.toContain('viewBox="0 0 300 300"');
  });
});
