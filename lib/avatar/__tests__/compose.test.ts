import { describe, expect, it } from 'vitest';
import {
  AVATAR_BACKGROUNDS,
  AVATAR_KINDS,
  agentAvatarNotionUrl,
  categoriasDe,
  composeAvatarSvg,
  composePartThumbSvg,
  isNotionAvatarUrl,
  notionAvatarVersion,
  parseAvatarConfig,
  randomAvatarConfig,
  serializeAvatarConfig,
  sugerenciaParaAgente,
  userAvatarUrl,
} from '../compose';

describe('parseAvatarConfig', () => {
  it('acepta una configuración válida y la devuelve limpia', () => {
    const c = parseAvatarConfig({ v: 1, tipo: 'persona', partes: { cara: 2, cabello: 4 }, fondo: 1 });
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
    for (const tipo of AVATAR_KINDS) {
      const c = randomAvatarConfig(tipo);
      expect(parseAvatarConfig(serializeAvatarConfig(c))).toEqual(c);
    }
  });
});

describe('composeAvatarSvg', () => {
  it('compone todas las opciones de todas las categorías sin romper el SVG', () => {
    for (const tipo of AVATAR_KINDS) {
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
    const c = randomAvatarConfig('persona', { fondo: 0 });
    const svg = composeAvatarSvg(c, { size: 64, title: '<b>Ana & "Luis"</b>' });
    expect(svg).toContain('<rect width="300" height="300" fill="#f2f2f2"/>');
    expect(svg).toContain('width="64"');
    expect(svg).toContain('&lt;b&gt;Ana &amp; &quot;Luis&quot;&lt;/b&gt;');
    const transparente = AVATAR_BACKGROUNDS.findIndex((f) => f.color === null);
    expect(composeAvatarSvg({ ...c, fondo: transparente })).not.toContain('<rect width="300"');
  });

  it('el dibujo es blanco y negro puro (sin otros colores que el fondo)', () => {
    for (const tipo of AVATAR_KINDS) {
      for (const cat of categoriasDe(tipo)) {
        cat.options.forEach((_o, i) => {
          const c = randomAvatarConfig(tipo, {}, () => 0);
          c.partes[cat.id] = i;
          const colores = composeAvatarSvg({ ...c, fondo: 1 }).match(/#[0-9a-f]{3,6}\b/gi) ?? [];
          for (const color of colores) expect(['#000', '#fff', '#ffffff']).toContain(color.toLowerCase());
        });
      }
    }
  });

  it('las categorías tienen claves únicas y los ids no cambian de nombre', () => {
    expect(categoriasDe('persona').map((c) => c.id)).toEqual([
      'cara', 'cabello', 'ojos', 'cejas', 'nariz', 'boca', 'barba', 'gafas', 'accesorios', 'detalles',
    ]);
    expect(categoriasDe('animal').map((c) => c.id)).toEqual(['animal', 'ojos', 'cejas', 'boca', 'ropa', 'gafas', 'accesorios']);
    expect(categoriasDe('planeta').map((c) => c.id)).toEqual(['planeta', 'carita', 'ojos', 'cejas', 'boca', 'accesorios', 'decorado']);
    expect(categoriasDe('constelacion').map((c) => c.id)).toEqual(['constelacion', 'estrella', 'marco', 'cielo']);
  });

  it('el catálogo no se reordena: nombres en su índice', () => {
    // Si alguna de estas falla, se reordenó el catálogo y los avatares
    // guardados cambiarían de dibujo. Lo nuevo va AL FINAL.
    const nombres = (tipo: Parameters<typeof categoriasDe>[0], id: string) =>
      categoriasDe(tipo).find((c) => c.id === id)!.options.map((o) => o.label);
    expect(nombres('planeta', 'planeta').slice(0, 11)).toEqual([
      'Mercurio', 'Venus', 'Tierra', 'Marte', 'Júpiter', 'Saturno', 'Urano', 'Neptuno', 'Luna', 'Sol', 'Plutón',
    ]);
    expect(nombres('constelacion', 'constelacion').slice(0, 12)).toEqual([
      'Orión', 'Osa Mayor', 'Casiopea', 'Escorpio', 'Lira (Vega)', 'Can Mayor (Sirio)', 'Cruz del Sur', 'Leo',
      'Cisne', 'Osa Menor', 'Pléyades (Atlas)', 'Géminis',
    ]);
    expect(nombres('animal', 'animal').slice(0, 11)).toEqual([
      'Gato', 'Perro', 'Zorro', 'Búho', 'Oso', 'Conejo', 'Panda', 'León', 'Pingüino', 'Koala', 'Mono',
    ]);
    // Persona: piezas de Noto avatar (CC0), una por archivo 0.svg, 1.svg…
    const conteo = Object.fromEntries(categoriasDe('persona').map((c) => [c.id, c.options.length]));
    expect(conteo).toEqual({
      cara: 16, cabello: 59, ojos: 14, cejas: 16, nariz: 14, boca: 20, barba: 17, gafas: 15, accesorios: 15, detalles: 14,
    });
  });
});

describe('randomAvatarConfig', () => {
  it('siempre produce configuraciones válidas', () => {
    for (let i = 0; i < 200; i += 1) {
      const tipo = AVATAR_KINDS[i % AVATAR_KINDS.length];
      expect(parseAvatarConfig(randomAvatarConfig(tipo))).not.toBeNull();
    }
  });

  it('nunca junta gafas con un accesorio (salvo los combinables)', () => {
    let semilla = 7;
    const rnd = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
    for (const tipo of ['persona', 'animal'] as const) {
      const cats = categoriasDe(tipo);
      const gafas = cats.find((c) => c.id === 'gafas')!;
      const acc = cats.find((c) => c.id === 'accesorios')!;
      for (let i = 0; i < 500; i += 1) {
        const c = randomAvatarConfig(tipo, {}, rnd);
        const opcionAcc = acc.options[c.partes.accesorios];
        if (gafas.options[c.partes.gafas].svg && opcionAcc.svg) expect(opcionAcc.combinable).toBe(true);
      }
    }
  });
});

describe('carita y figuras oscuras', () => {
  it('"Sin carita" quita ojos, cejas y boca del planeta', () => {
    const con = randomAvatarConfig('planeta', {}, () => 0);
    con.partes.carita = 0;
    const sin = { ...con, partes: { ...con.partes, carita: 1 } };
    expect(composeAvatarSvg(sin).length).toBeLessThan(composeAvatarSvg(con).length);
  });

  it('sobre Marte (planeta negro) la carita se pinta en blanco', () => {
    const c = randomAvatarConfig('planeta', {}, () => 0);
    c.partes.planeta = categoriasDe('planeta')[0].options.findIndex((o) => o.label === 'Marte');
    c.partes.carita = 0;
    const svg = composeAvatarSvg(c);
    expect(svg).toContain('<g stroke="#fff" fill="#000">');
  });

  it('con "Cielo negro" la constelación se invierte (líneas y estrellas blancas)', () => {
    const c = randomAvatarConfig('constelacion', {}, () => 0);
    c.partes.marco = categoriasDe('constelacion').find((x) => x.id === 'marco')!.options.findIndex((o) => o.label === 'Cielo negro');
    expect(composeAvatarSvg(c)).toContain('<g stroke="#fff" fill="#000">');
  });
});

describe('sugerencias para los asistentes de OLP', () => {
  it.each([
    ['Orión', 'constelacion', 'Orión'],
    ['Vega', 'constelacion', 'Lira (Vega)'],
    ['Sirio', 'constelacion', 'Can Mayor (Sirio)'],
    ['Atlas', 'constelacion', 'Pléyades (Atlas)'],
    ['Mercurio', 'planeta', 'Mercurio'],
    ['Galileo', 'planeta', 'Júpiter'],
    ['Kepler', 'planeta', 'Marte'],
  ])('%s arranca con %s (%s)', (nombre, tipo, figura) => {
    const c = sugerenciaParaAgente(nombre);
    expect(c?.tipo).toBe(tipo);
    const cat = categoriasDe(c!.tipo)[0];
    expect(cat.options[c!.partes[cat.id]].label).toBe(figura);
  });

  it('un nombre sin sugerencia devuelve null', () => {
    expect(sugerenciaParaAgente('Horus')).toBeNull();
    expect(sugerenciaParaAgente('ORION')?.tipo).toBe('constelacion');
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
