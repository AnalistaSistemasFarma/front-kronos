#!/usr/bin/env node
/**
 * Hoja de muestra de las CABEZAS-FIGURA de los asistentes (cabezas.ts): cada
 * figura con varias combinaciones de ojos, boca, gafas, pelo y colores de
 * Lorelei; el selector "Cabezas" tal como lo ve el editor; y los 7 asistentes
 * de OLP con su avatar de siempre y con una cabeza-figura temática.
 * Genera <salida>.html y, con Playwright, <salida>.png.
 *
 *   node scripts/avatar/muestra-cabezas-figura.mjs /ruta/avatares-cabezas-figura
 *
 * Usa jiti para importar lib/avatar/*.ts tal cual (sin copiar lógica).
 */
import { writeFileSync } from 'node:fs';
import { createJiti } from 'jiti';

const salida = process.argv[2] ?? 'avatares-cabezas-figura';
const jiti = createJiti(import.meta.url);
const { composeAvatarSvg, conValor, etiquetaOpcion, sugerenciaParaAgente, thumbDataUri, CABEZAS_ASISTENTE } = await jiti.import(
  '../../lib/avatar/compose.ts'
);
const { CABEZAS_FIGURA } = await jiti.import('../../lib/avatar/cabezas.ts');

const escapar = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const svgUri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

// Tres caras distintas sobre cada figura.
const base = sugerenciaParaAgente('Kepler');
const combos = [
  ['sin pelo', { eyes: 'variant03', eyebrows: 'variant05', mouth: 'happy02', nose: 'variant01', glasses: null, hair: null }],
  ['gafas y aretes', { eyes: 'variant12', eyebrows: 'variant09', mouth: 'happy08', nose: 'variant04', glasses: 'variant04', earrings: 'variant01', hair: null }],
  [
    'pelo, pecas y color',
    { eyes: 'variant20', eyebrows: 'variant02', mouth: 'happy15', nose: 'variant02', glasses: 'variant02', hair: 'variant20', freckles: 'variant01', skinColor: 'ecad80', hairColor: 'a55728', backgroundColor: 'b6e3f4' },
  ],
];
// Junto a cada figura, una cabeza Lorelei normal (Cabeza 1, misma cara) para comparar el trazo.
const lorelei = { ...base, earrings: null, freckles: null, beard: null, hairAccessories: null, ...combos[0][1], hair: base.hair, head: 'variant01' };
const comparar = `<img class="lor" src="${svgUri(composeAvatarSvg(lorelei))}" width="104" height="104" alt="" title="Lorelei · Cabeza 1">`;
const figuras = CABEZAS_FIGURA.map((f) => {
  const celdas = comparar + combos
    .map(([t, over]) => {
      const c = { ...base, earrings: null, freckles: null, beard: null, hairAccessories: null, ...over, head: 'figura:' + f.id };
      return `<img src="${svgUri(composeAvatarSvg(c))}" width="104" height="104" alt="" title="${escapar(t)}">`;
    })
    .join('');
  return `<figure class="fig"><div class="tres">${celdas}</div><figcaption>${escapar(f.label)}</figcaption></figure>`;
}).join('');

// Trazo de cerca: Lorelei y algunas figuras, grandes y sin cara, para ver el grosor.
const sinCara = { ...base, eyes: 'variant01', hair: null, glasses: null, earrings: null, freckles: null, beard: null, hairAccessories: null };
const cerca = [
  ['Lorelei · Cabeza 1', { ...sinCara, hair: base.hair, head: 'variant01' }],
  ...['gato', 'oso', 'saturno', 'orion', 'estrella', 'clasico'].map((id) => [id, { ...sinCara, head: 'figura:' + id }]),
]
  .map(([t, c]) => `<figure><img src="${svgUri(composeAvatarSvg(c))}" width="180" height="180" alt=""><figcaption>${escapar(t)}</figcaption></figure>`)
  .join('');

// El selector "Cabezas" de un asistente (miniaturas del editor, en orden).
const actual = sugerenciaParaAgente('Orión');
const selector = CABEZAS_ASISTENTE.map(
  (v) =>
    `<figure class="opt"><img src="${thumbDataUri(actual, 'head', v)}" width="72" height="72" alt=""><figcaption>${escapar(etiquetaOpcion('head', v))}</figcaption></figure>`
).join('');

// Los asistentes de OLP: su avatar de siempre y con una cabeza-figura temática (mismos ojos, boca, etc.).
const TEMA = { Atlas: 'pleyades', Galileo: 'jupiter', Kepler: 'marte', Mercurio: 'mercurio', 'Orión': 'orion', Sirio: 'can-mayor', Vega: 'lira' };
const olp = Object.entries(TEMA)
  .map(([n, fig]) => {
    const persona = sugerenciaParaAgente(n);
    const conFig = conValor(persona, 'head', 'figura:' + fig);
    const img = (c, w) => `<img src="${svgUri(composeAvatarSvg(c, { title: n }))}" width="${w}" height="${w}" alt="">`;
    return `<figure class="olp"><div class="dos">${img(persona, 120)}${img(conFig, 120)}</div>
    <div class="chicos">${img(conFig, 40)}${img(conFig, 28)}</div>
    <figcaption>${escapar(n)} · ${escapar(etiquetaOpcion('head', conFig.head))}</figcaption></figure>`;
  })
  .join('');

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cabezas-figura de asistentes — muestra</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;background:#fff;color:#111;width:1380px}
  h1{font-size:20px;margin:0 0 4px} p{margin:0 0 14px;color:#555;font-size:13px} h2{font-size:15px;margin:22px 0 8px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px} .lor{outline:2px dashed #9ca3af;outline-offset:-2px}
  figure{margin:0;border:1px solid #e5e7eb;border-radius:12px;padding:8px;text-align:center}
  img{border-radius:50%} .tres,.dos{display:flex;gap:6px;justify-content:center}
  figcaption{font-size:12px;margin-top:6px;color:#333}
  .sel{display:flex;flex-wrap:wrap;gap:6px} .opt{width:92px;padding:6px} .opt img{border-radius:10px;background:#fff;border:1px solid #d1d5db}
  .olps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .cerca{display:flex;gap:8px;flex-wrap:wrap} .chicos{display:flex;gap:8px;justify-content:center;align-items:center;margin-top:6px}
</style></head><body>
<h1>Cabezas-figura de los asistentes (Lorelei · DiceBear 9.4.3)</h1>
<p>Opciones adicionales del selector «Cabezas», después de Cabeza 1…4. Sobre cada figura se componen las partes de Lorelei: ojos, cejas, boca, nariz, gafas, aretes, pecas, barba, flores y pelo (o «Ninguno»). Relleno = color de piel; acentos = color de cabello. Por figura: <b>Lorelei Cabeza 1 (borde punteado, para comparar el trazo)</b> · sin pelo · con gafas y aretes · con pelo, pecas y colores. El contorno de las figuras usa el trazo de Lorelei: formas rellenas negras de grosor variable, con huecos y puntas afinadas, sin stroke ni degradados.</p>
<h2>Trazo de cerca</h2><div class="cerca">${cerca}</div>
<div class="grid">${figuras}</div>
<h2>Selector «Cabezas» de un asistente (miniaturas del editor, en orden)</h2>
<div class="sel">${selector}</div>
<h2>Asistentes de OLP: avatar actual (Lorelei, semilla = nombre) → con cabeza-figura temática</h2>
<div class="olps">${olp}</div>
</body></html>`;

writeFileSync(salida + '.html', html);
try {
  const { chromium } = await import('playwright');
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 1430, height: 800 }, deviceScaleFactor: 1.5 });
  await pagina.setContent(html, { waitUntil: 'load' });
  await pagina.screenshot({ path: salida + '.png', fullPage: true });
  await navegador.close();
  console.log('Listo: ' + salida + '.html y ' + salida + '.png');
} catch (error) {
  console.log('HTML listo en ' + salida + '.html; PNG no generado (' + error.message + ')');
}
