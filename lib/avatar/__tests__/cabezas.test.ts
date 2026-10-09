import { describe, expect, it, vi } from 'vitest';

// El CSS module no aporta a la prueba (y Vite no carga la config de PostCSS de Next).
vi.mock('../../../components/avatar/avatarEditor.module.css', () => ({
  default: new Proxy({}, { get: (_t, clave) => String(clave) }),
}));
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { createAvatar } from '@dicebear/core';
import * as lorelei from '@dicebear/lorelei';
import AvatarEditor from '../../../components/avatar/AvatarEditor';
import { composeAgentAvatarSvg, parseAgentAvatarConfig, serializeAgentAvatarConfig } from '../agente';
import { CABEZAS_FIGURA, GROSOR_LORELEI, VALORES_CABEZA_FIGURA, cabezaFiguraMarkup, esCabezaFigura, figuraLlevaPelo, loreleiCabezas } from '../cabezas';
import { pincel } from '../pincel';
import {
  CABEZAS_ASISTENTE,
  CATALOGO,
  avatarDataUri,
  categoriasEditor,
  composeAvatarSvg,
  conValor,
  etiquetaOpcion,
  opcionesLorelei,
  parseAvatarConfig,
  serializeAvatarConfig,
  sugerenciaParaAgente,
  thumbDataUri,
  valorCategoria,
} from '../compose';
import { figuraV4ACabeza, parseFiguraConfig } from '../figuras';
import type { AvatarConfig } from '../types';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const OLP = ['Atlas', 'Galileo', 'Kepler', 'Mercurio', 'Orión', 'Sirio', 'Vega'];
const conFigura = (id: string, over: Partial<AvatarConfig> = {}): AvatarConfig => ({
  ...sugerenciaParaAgente('Kepler'),
  head: 'figura:' + id,
  hair: null,
  ...over,
});

describe('los v3 de siempre se ven byte a byte igual que en 1a1fd46', () => {
  // Hashes generados con el código de testing en 1a1fd46 (#554), antes de este cambio.
  const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'v3-1a1fd46.json'), 'utf8')) as {
    casos: Array<{ owner: 'user' | 'agent'; json: string; svg: string; svgTitulo64: string; dataUri: string; thumbs: string; agente?: string }>;
  };

  it('trae personas y los 7 asistentes de OLP', () => {
    expect(fixture.casos.length).toBeGreaterThanOrEqual(19);
    expect(fixture.casos.filter((c) => c.owner === 'agent').map((c) => JSON.parse(c.json).seed)).toEqual(OLP);
  });

  it.each(fixture.casos.map((c, i) => [i, c] as const))('caso %i', (_i, caso) => {
    const config = parseAvatarConfig(caso.json, caso.owner)!;
    expect(config).not.toBeNull();
    expect(serializeAvatarConfig(config)).toBe(caso.json);
    expect(sha(composeAvatarSvg(config))).toBe(caso.svg);
    expect(sha(composeAvatarSvg(config, { size: 64, title: 'Nombre <x>' }))).toBe(caso.svgTitulo64);
    expect(sha(avatarDataUri(config))).toBe(caso.dataUri);
    const thumbs = ['hair', 'head', 'eyes', 'glasses', 'mouth', 'backgroundColor', 'flip'] as const;
    expect(sha(thumbs.map((k) => thumbDataUri(config, k, valorCategoria(config, k))).join('|'))).toBe(caso.thumbs);
    if (caso.agente) {
      const agente = parseAgentAvatarConfig(caso.json)!;
      expect(sha(composeAgentAvatarSvg(agente, { title: 'Nombre <x>' }))).toBe(caso.agente);
      expect(serializeAgentAvatarConfig(agente)).toBe(caso.json);
    }
  });

  it('con Cabeza 1…4 el style con cabezas-figura es exactamente Lorelei', () => {
    for (const n of OLP) {
      const op = opcionesLorelei(sugerenciaParaAgente(n));
      expect(createAvatar(loreleiCabezas as typeof lorelei, op).toString()).toBe(createAvatar(lorelei, op).toString());
    }
  });
});

describe('catálogo de cabezas-figura', () => {
  it('van DESPUÉS de Cabeza 1…4 y solo para asistentes', () => {
    expect(CABEZAS_ASISTENTE.slice(0, 4)).toEqual(CATALOGO.head);
    expect(CABEZAS_ASISTENTE.slice(4)).toEqual(VALORES_CABEZA_FIGURA);
    expect(categoriasEditor('agent').find((c) => c.id === 'head')!.opciones).toEqual(CABEZAS_ASISTENTE);
    expect(categoriasEditor('user').find((c) => c.id === 'head')!.opciones).toEqual(CATALOGO.head);
    expect(categoriasEditor('user', true).find((c) => c.id === 'hair')!.opciones).toEqual(CATALOGO.hair);
  });

  it('trae animales, planetas, constelaciones, estrellas y robots', () => {
    const ids = (g: string) => CABEZAS_FIGURA.filter((c) => c.grupo === g).map((c) => c.id);
    expect(ids('animal')).toEqual(['gato', 'perro', 'zorro', 'buho', 'oso', 'conejo', 'panda', 'leon', 'pinguino', 'koala', 'mono', 'pulpo']);
    expect(ids('planeta')).toEqual(['mercurio', 'venus', 'tierra', 'marte', 'jupiter', 'saturno', 'urano', 'neptuno', 'pluton', 'luna']);
    expect(ids('constelacion')).toHaveLength(12);
    expect(ids('constelacion')).toEqual(expect.arrayContaining(['orion', 'lira', 'can-mayor', 'pleyades']));
    expect(ids('estrella')).toEqual(['sol', 'estrella', 'destello', 'luna-creciente', 'cometa']);
    expect(ids('robot')).toEqual(['clasico', 'pantalla', 'redondo', 'cubo']);
    expect(new Set(VALORES_CABEZA_FIGURA).size).toBe(VALORES_CABEZA_FIGURA.length);
  });

  it('etiquetas en español', () => {
    expect(etiquetaOpcion('head', 'variant02')).toBe('Cabeza 2');
    expect(etiquetaOpcion('head', 'figura:zorro')).toBe('Zorro');
    expect(etiquetaOpcion('head', 'figura:can-mayor')).toBe('Can Mayor (Sirio)');
    expect(etiquetaOpcion('hair', null)).toBe('Ninguno');
  });
});

describe('validación', () => {
  it('un asistente acepta una cabeza-figura, con o sin pelo', () => {
    const c = conFigura('zorro');
    expect(parseAvatarConfig(c, 'agent')).toEqual(c);
    expect(parseAvatarConfig(serializeAvatarConfig(c), 'agent')).toEqual(c);
    expect(parseAgentAvatarConfig(serializeAvatarConfig(c))).toEqual(c);
    expect(parseAvatarConfig({ ...c, hair: 'variant20' }, 'agent')).toEqual({ ...c, hair: 'variant20' });
    expect(serializeAvatarConfig(c).length).toBeLessThan(400);
  });

  it('una persona NO acepta cabezas-figura ni pelo vacío', () => {
    const c = conFigura('zorro');
    expect(parseAvatarConfig(c, 'user')).toBeNull();
    expect(parseAvatarConfig({ ...c, hair: 'variant20' }, 'user')).toBeNull();
    expect(parseAvatarConfig({ ...sugerenciaParaAgente('Vega'), hair: null }, 'user')).toBeNull();
  });

  it('sin pelo solo con cabeza-figura; nada fuera del catálogo', () => {
    const c = conFigura('zorro');
    expect(parseAvatarConfig({ ...c, head: 'variant01' }, 'agent')).toBeNull(); // persona sin pelo
    for (const head of ['figura:dragon', 'figura:', 'figura:ZORRO', 'zorro', 'figura:zorro ', '<script>', 'figura:__proto__'])
      expect(parseAvatarConfig({ ...c, head }, 'agent')).toBeNull();
    expect(parseAvatarConfig({ ...c, hair: undefined }, 'agent')).toBeNull();
    expect(parseAvatarConfig({ ...c, hair: 'variant99' }, 'agent')).toBeNull();
    expect(parseAvatarConfig({ ...c, mouth: 'sad01' }, 'agent')).toBeNull(); // los asistentes siempre sonríen
    expect(parseAvatarConfig({ ...c, otra: 1 }, 'agent')).toBeNull();
    expect(esCabezaFigura('figura:gato')).toBe(true);
    expect(esCabezaFigura('figura:hasOwnProperty')).toBe(false);
  });
});

describe('figuras v4 del #554: se leen convertidas, no se pierden', () => {
  // El único v4 que hay en KRONOSDB_PRUEBAS (agente 1), tal cual.
  const guardado = '{"v":4,"kind":"animal","variante":"gato","cara":"alegre","extra":null,"relleno":"ffffff","acento":"2c1b8f","fondo":"f2f2f2"}';

  it('el v4 guardado se convierte a su cabeza-figura con los mismos colores', () => {
    const c = parseAgentAvatarConfig(guardado)!;
    expect(c).toMatchObject({ v: 3, estilo: 'lorelei', head: 'figura:gato', hair: null, skinColor: 'ffffff', hairColor: '2c1b8f', backgroundColor: 'f2f2f2' });
    expect(c.mouth.startsWith('happy')).toBe(true);
    expect(composeAgentAvatarSvg(c)).toContain('#2c1b8f');
    // Al guardarlo de nuevo queda en el formato nuevo.
    expect(JSON.parse(serializeAgentAvatarConfig(c)).v).toBe(3);
  });

  it('todas las figuras v4 válidas se convierten; las inválidas siguen rechazándose', () => {
    const v4 = (o: object) => ({ v: 4, kind: 'animal', variante: 'gato', cara: 'feliz', extra: null, relleno: 'ffffff', acento: '000000', fondo: 'f2f2f2', ...o });
    const tipos: Record<string, string[]> = {
      animal: ['gato', 'perro', 'zorro', 'buho', 'oso', 'conejo', 'panda', 'leon', 'pinguino', 'koala', 'mono', 'pulpo'],
      planeta: ['mercurio', 'venus', 'tierra', 'marte', 'jupiter', 'saturno', 'urano', 'neptuno', 'pluton', 'luna'],
      constelacion: ['orion', 'osa-mayor', 'casiopea', 'escorpio', 'lira', 'can-mayor', 'cruz-del-sur', 'leo', 'cisne', 'osa-menor', 'pleyades', 'geminis'],
      estrella: ['sol', 'estrella', 'destello', 'luna-creciente', 'cometa'],
      robot: ['clasico', 'pantalla', 'redondo', 'cubo'],
    };
    for (const [kind, variantes] of Object.entries(tipos))
      for (const variante of variantes)
        for (const cara of ['feliz', 'alegre', 'tranquilo', 'tierno', 'guino', 'curioso', 'picaro', 'gatuno']) {
          const c = parseAgentAvatarConfig(v4({ kind, variante, cara }));
          expect(c?.head).toBe('figura:' + variante);
        }
    expect(parseAgentAvatarConfig(v4({ kind: 'planeta', variante: 'saturno', cara: 'ninguna', extra: 'anillo' }))?.head).toBe('figura:saturno');
    expect(parseAgentAvatarConfig(v4({ extra: 'gafas' }))?.glasses).toBe('variant01');
    expect(parseAgentAvatarConfig(v4({ extra: 'gafas-sol' }))?.glasses).toBe('variant02');
    expect(parseAgentAvatarConfig(v4({ extra: 'flor' }))?.hairAccessories).toBe('flowers');
    expect(parseAgentAvatarConfig(v4({ variante: 'saturno' }))).toBeNull(); // variante de otro tipo
    expect(parseAgentAvatarConfig(v4({ cara: 'ninguna' }))).toBeNull();
    expect(parseAgentAvatarConfig(v4({ relleno: 'red' }))).toBeNull();
    expect(parseAgentAvatarConfig(v4({ otra: 1 }))).toBeNull();
    expect(parseAvatarConfig(v4({}), 'user')).toBeNull(); // las personas no aceptan v4
    expect(figuraV4ACabeza(parseFiguraConfig(v4({}))!).head).toBe('figura:gato');
  });
});

/* ───────────────────── Render: la figura reemplaza SOLO la cabeza ───────────────────── */

const GRUPO = '<g transform="translate(10 -60)">';
const VACIO = ['__ninguno__'];
/** Lorelei con opciones fuera de su catálogo (partes vacías): el tipo de DiceBear no las admite. */
const lorelei_ = (op: Record<string, unknown>) => createAvatar(lorelei, op as Parameters<typeof createAvatar<typeof lorelei>>[1]).toString();
/** Trazos de la Cabeza 1 de Lorelei (sin cara) para una piel, calculados aparte. */
function trazosCabeza1(op: Record<string, unknown>): string {
  const sinCara = {
    ...op, head: ['variant01'], hair: ['variant01'], eyes: VACIO, eyebrows: VACIO, nose: VACIO, mouth: VACIO,
    earringsProbability: 0, frecklesProbability: 0, beardProbability: 0, glassesProbability: 0, hairAccessoriesProbability: 0,
  };
  const a = lorelei_(sinCara);
  const b = lorelei_({ ...sinCara, head: VACIO });
  const i = a.indexOf(GRUPO) + GRUPO.length;
  const fin = b.length - b.indexOf(GRUPO) - GRUPO.length;
  return a.slice(i, a.length - fin);
}

describe('cada cabeza-figura con las partes de Lorelei', () => {
  const caras: Array<Partial<AvatarConfig>> = [
    { eyes: 'variant03', mouth: 'happy02', glasses: null },
    { eyes: 'variant12', mouth: 'happy08', glasses: 'variant04', earrings: 'variant01', freckles: 'variant01', beard: 'variant02', hairAccessories: 'flowers' },
    { eyes: 'variant20', mouth: 'happy15', glasses: 'variant02', skinColor: 'ecad80', hairColor: 'a55728', backgroundColor: 'transparent', flip: true },
  ];

  it('con pelo: el SVG es el de Lorelei con la Cabeza 1 cambiada por la figura (todas × los 48 pelos)', () => {
    for (const head of VALORES_CABEZA_FIGURA)
      for (const [i, pelo] of CATALOGO.hair.entries()) {
        const cara = caras[i % caras.length];
        const c = conFigura(head.slice(7), { ...cara, hair: pelo });
        const figura = composeAvatarSvg(c);
        const persona = composeAvatarSvg({ ...c, head: 'variant01' });
        const op = opcionesLorelei(c);
        const markup = cabezaFiguraMarkup(head, '#' + c.skinColor, '#' + c.hairColor);
        expect(figura.split(markup)).toHaveLength(2);
        expect(figura.replace(markup, trazosCabeza1(op))).toBe(persona);
      }
  });

  it('sin pelo: lo mismo pero sin el pelo (ni el de atrás ni el de adelante)', () => {
    for (const head of VALORES_CABEZA_FIGURA)
      for (const cara of caras) {
        const c = conFigura(head.slice(7), cara);
        const sinPelo = composeAvatarSvg(c);
        // Con el pelo 1 (que no tiene pelo de atrás) = sin pelo + el pelo 1 de adelante.
        const conPelo1 = composeAvatarSvg({ ...c, hair: 'variant01' });
        const pelo1 = lorelei_({ ...opcionesLorelei({ ...c, head: 'variant01', hair: 'variant01' }), head: VACIO, hairAccessoriesProbability: 0 });
        const delante = pelo1.slice(pelo1.indexOf(GRUPO) + GRUPO.length, pelo1.indexOf('</g><g transform="translate(10 -60)">'));
        expect(delante.length).toBeGreaterThan(100);
        expect(conPelo1.replace(delante, '')).toBe(sinPelo);
        expect(sinPelo).toContain(cabezaFiguraMarkup(head, '#' + c.skinColor, '#' + c.hairColor));
        expect(sinPelo).not.toMatch(/%[RA]|undefined|NaN|null/);
        expect(sinPelo).not.toMatch(/<script|<foreignObject|\son[a-z]+=/i);
        expect(sinPelo.split('<g').length).toBe(sinPelo.split('</g>').length);
      }
  });

  it('la cara de Lorelei va encima de la figura (ojos, boca, nariz, gafas)', () => {
    const c = conFigura('saturno', { glasses: 'variant04' });
    const svg = composeAvatarSvg(c);
    const persona = composeAvatarSvg({ ...c, head: 'variant01', hair: 'variant01' });
    // La cara (todo lo que va después de los trazos de la cabeza en la persona) aparece tras la figura.
    const trazos = trazosCabeza1(opcionesLorelei({ ...c, hair: 'variant01' }));
    const despues = persona.slice(persona.indexOf(trazos) + trazos.length, persona.indexOf(trazos) + trazos.length + 400);
    expect(svg.indexOf(despues)).toBeGreaterThan(svg.indexOf(cabezaFiguraMarkup('figura:saturno', '#ffffff', '#000000')));
  });

  it('colores: relleno = piel, acentos = cabello; flip, tamaño, título y data URI como siempre', () => {
    const c = conFigura('panda', { skinColor: 'b6e3f4', hairColor: '2c1b8f', backgroundColor: 'ffd5dc' });
    const svg = composeAvatarSvg(c, { size: 64, title: '<b>"Kepler"</b>' });
    expect(svg).toContain('fill="#b6e3f4"');
    expect(svg).toContain('fill="#2c1b8f"');
    expect(svg).toContain('fill="#ffd5dc"');
    expect(svg).toContain('width="64" height="64"');
    expect(svg).toContain('<title>&lt;b&gt;&quot;Kepler&quot;&lt;/b&gt;</title>');
    expect(svg).toContain('Lorelei');
    expect(composeAvatarSvg({ ...c, flip: true })).toContain('scale(-1 1)');
    expect(avatarDataUri(c).startsWith('data:image/svg+xml;utf8,')).toBe(true);
    // Por defecto (piel blanca, cabello negro) solo blanco, negro, grises planos (sombras) y el gris del fondo.
    for (const head of VALORES_CABEZA_FIGURA) {
      const bn = composeAvatarSvg(conFigura(head.slice(7)));
      for (const col of new Set(bn.match(/#[0-9a-f]{3,6}\b/gi))) {
        const h = col.toLowerCase().slice(1);
        const hex = h.length === 3 ? h.replace(/./g, (x) => x + x) : h;
        expect(hex.slice(0, 2) === hex.slice(2, 4) && hex.slice(2, 4) === hex.slice(4, 6)).toBe(true);
      }
    }
  });
});

describe('el trazo de las figuras es el de Lorelei (msg 15787)', () => {
  it('Lorelei no usa stroke: contornos como formas rellenas #000, sin degradados ni transparencias', () => {
    const persona = composeAvatarSvg(sugerenciaParaAgente('Vega'));
    expect(persona).not.toMatch(/stroke/);
    expect(persona).not.toMatch(/Gradient|opacity/);
  });

  it('las figuras tampoco: sin stroke, sin degradados, sin opacidades; contornos rellenos negros', () => {
    for (const head of VALORES_CABEZA_FIGURA) {
      const m = cabezaFiguraMarkup(head, '#ffffff', '#000000');
      expect(m).not.toMatch(/stroke|Gradient|opacity/);
      // Hay contornos de pincel (formas rellenas negras) y todos los path tienen geometría válida.
      expect(m).toMatch(/<path d="M[^"]+ Z" fill="#000"/);
      expect(m).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it('el grosor del pincel es el medido en Lorelei, en el mismo sistema de coordenadas', () => {
    expect(GROSOR_LORELEI).toBeGreaterThanOrEqual(10);
    expect(GROSOR_LORELEI).toBeLessThanOrEqual(14);
    // El grupo de la figura usa la misma escala que siempre (lienzo 980 de Lorelei).
    expect(cabezaFiguraMarkup('figura:gato', '#ffffff', '#000000')).toMatch(/^<g transform="matrix\(2\.85 0 0 2\.85 /);
  });

  it('pincel: ancho variable, puntas afinadas y huecos en los cerrados largos', () => {
    const recta = pincel('M0 0 L100 0', { ancho: 4, variacion: 0 });
    const ys = [...recta.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Math.abs(Number(m[2])));
    expect(Math.max(...ys)).toBeCloseTo(2, 0);
    expect(Math.min(...ys.filter((y) => y > 0))).toBeLessThan(1.2); // puntas afinadas
    expect(pincel('M0 0 A100 100 0 1 0 200 0 A100 100 0 1 0 0 0 Z', { ancho: 4, huecos: true }).split('M').length - 1).toBeGreaterThan(1);
    expect(pincel('M0 0 L10 0 L10 10 L0 10 Z', { ancho: 2 }).startsWith('M')).toBe(true);
    expect(() => pincel('m0 0 l10 10', { ancho: 2 })).toThrow();
  });
});

describe('editor: la cabeza-figura es una opción más de "Cabezas"', () => {
  it('al elegir una figura sin sentido para el pelo, el pelo queda en "Ninguno"; al volver a persona, vuelve el pelo', () => {
    const persona = sugerenciaParaAgente('Orión');
    const zorro = conValor(persona, 'head', 'figura:zorro');
    expect(zorro).toMatchObject({ head: 'figura:zorro', hair: null, eyes: persona.eyes, mouth: persona.mouth, glasses: persona.glasses });
    expect(figuraLlevaPelo('figura:zorro')).toBe(false);
    // Una figura con pelo (perro, oso, sol) lo conserva.
    expect(conValor(persona, 'head', 'figura:perro').hair).toBe(persona.hair);
    // Se puede poner pelo a cualquier figura.
    expect(conValor(zorro, 'hair', 'variant20').hair).toBe('variant20');
    expect(parseAvatarConfig(conValor(zorro, 'hair', 'variant20'), 'agent')).not.toBeNull();
    // De vuelta a una cabeza de persona: el pelo que le da DiceBear a su nombre.
    const deVuelta = conValor(zorro, 'head', 'variant03');
    expect(deVuelta.hair).toBe(persona.hair);
    expect(parseAvatarConfig(deVuelta, 'agent')).not.toBeNull();
  });

  it('con una cabeza-figura, el cabello ofrece "Ninguno"; las miniaturas de figura muestran la figura entera', () => {
    const c = conFigura('saturno');
    expect(categoriasEditor('agent', true).find((x) => x.id === 'hair')!.opciones[0]).toBeNull();
    expect(categoriasEditor('agent', false).find((x) => x.id === 'hair')!.opciones).toEqual(CATALOGO.hair);
    for (const cat of categoriasEditor('agent', true))
      for (const v of cat.opciones) expect(thumbDataUri(c, cat.id, v).startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(thumbDataUri(c, 'head', 'figura:conejo'))).toContain('viewBox="40 20 900 900"');
    expect(decodeURIComponent(thumbDataUri(c, 'head', 'variant02'))).toContain('viewBox="150 220 680 680"');
  });

  it('render en el servidor del editor de un asistente con cabeza-figura (sin pestañas de tipo)', () => {
    const html = renderToStaticMarkup(
      createElement(MantineProvider, null, createElement(AvatarEditor, { config: conFigura('leon'), onChange: () => {}, owner: 'agent', semillaFija: 'Kepler' }))
    );
    expect(html).toContain('data-testid="avatar-canvas"');
    expect(html).toContain('Cabeza: León');
    expect(html).toContain('Cabello: Ninguno');
    expect(html).not.toContain('Tipo de avatar');
    expect(html).not.toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 980"');
  });
});
