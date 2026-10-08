#!/usr/bin/env node
/**
 * Hoja de muestra del avatar Lorelei (DiceBear): personas variadas y los
 * asistentes de OLP con la semilla de su nombre (la misma sugerencia que abre
 * el editor del Perfil). Genera <salida>.html y, con Playwright, <salida>.png.
 *
 *   node scripts/avatar/muestra-lorelei.mjs /ruta/avatares-lorelei-muestra
 *
 * Usa jiti para importar lib/avatar/compose.ts tal cual (sin copiar lógica).
 */
import { writeFileSync } from 'node:fs';
import { createJiti } from 'jiti';

const salida = process.argv[2] ?? 'avatares-lorelei-muestra';
const jiti = createJiti(import.meta.url);
const { composeAvatarSvg, configDesdeSemilla, sugerenciaParaAgente, RECORTES, composePartThumbSvg } = await jiti.import(
  '../../lib/avatar/compose.ts'
);

const escapar = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const svgUri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

const personas = [
  ['Persona · semilla "ana"', configDesdeSemilla('ana')],
  ['Persona · "carlos" (color)', configDesdeSemilla('carlos', { hairColor: '724133', skinColor: 'ecad80', backgroundColor: 'b6e3f4' })],
  ['Persona · "lucia"', configDesdeSemilla('lucia', { backgroundColor: 'ffd5dc' })],
  ['Persona · "andres" + lentes, barba', { ...configDesdeSemilla('andres'), glasses: 'variant02', beard: 'variant01' }],
  ['Persona · "valentina" (color)', configDesdeSemilla('valentina', { hairColor: 'a55728', skinColor: 'f2d3b1', backgroundColor: 'c0aede' })],
];
const agentes = ['Atlas', 'Galileo', 'Kepler', 'Mercurio', 'Orión', 'Sirio', 'Vega'].map((n) => [`Asistente OLP · ${n}`, sugerenciaParaAgente(n)]);
const todos = [...personas, ...agentes];

const tarjeta = ([titulo, config]) => `
  <figure>
    <img src="${svgUri(composeAvatarSvg(config, { title: titulo }))}" width="150" height="150" alt="">
    <div class="chicos">
      <img src="${svgUri(composeAvatarSvg(config))}" width="40" height="40" alt="">
      <img src="${svgUri(composeAvatarSvg(config))}" width="28" height="28" alt="">
    </div>
    <figcaption>${escapar(titulo)}</figcaption>
  </figure>`;

const muestraConfig = todos[0][1];
const recortes = Object.keys(RECORTES)
  .map((p) => `<figure class="rec"><img src="${svgUri(composePartThumbSvg(muestraConfig, p, muestraConfig[p] ?? (p === 'glasses' ? 'variant01' : p === 'beard' ? 'variant01' : p === 'earrings' ? 'variant01' : p === 'freckles' ? 'variant01' : p === 'hairAccessories' ? 'flowers' : null)))}" width="64" height="64" alt=""><figcaption>${p}</figcaption></figure>`)
  .join('');

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Avatares Lorelei — muestra</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;background:#fff;color:#111;width:1180px}
  h1{font-size:20px;margin:0 0 4px} p{margin:0 0 16px;color:#555;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:16px}
  figure{margin:0;border:1px solid #e5e7eb;border-radius:12px;padding:12px;text-align:center}
  figure>img{border-radius:50%;display:block;margin:0 auto}
  .chicos{display:flex;gap:8px;justify-content:center;align-items:center;margin-top:8px}
  .chicos img{border-radius:50%}
  figcaption{font-size:12px;margin-top:8px;color:#333}
  .recortes{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
  .rec{padding:6px} .rec img{border-radius:50%;background:#f3f4f6}
  h2{font-size:14px;margin:20px 0 4px}
</style></head><body>
<h1>Avatares de SynerLink con DiceBear · Lorelei</h1>
<p>@dicebear/core + @dicebear/lorelei 9.4.3 · diseño “Lorelei” de Lisa Wischofsky (CC0 1.0) · cada tarjeta a 150, 40 y 28 px. Asistentes de OLP: Lorelei con la semilla de su nombre.</p>
<div class="grid">${todos.map(tarjeta).join('')}</div>
<h2>Miniaturas del editor (recorte por parte)</h2>
<div class="recortes">${recortes}</div>
</body></html>`;

writeFileSync(`${salida}.html`, html);
try {
  const { chromium } = await import('playwright');
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 1230, height: 800 }, deviceScaleFactor: 2 });
  await pagina.setContent(html, { waitUntil: 'load' });
  await pagina.screenshot({ path: `${salida}.png`, fullPage: true });
  await navegador.close();
  console.log(`Listo: ${salida}.html y ${salida}.png`);
} catch (error) {
  console.log(`HTML listo en ${salida}.html; PNG no generado (${error.message})`);
}
