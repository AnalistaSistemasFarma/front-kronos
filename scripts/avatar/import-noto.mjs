#!/usr/bin/env node
/**
 * Importa las piezas de "Noto avatar" (Felix Wong, licencia CC0) desde una
 * copia del repositorio Mayandev/notion-avatar y genera
 * lib/avatar/noto/parts.generated.ts.
 *
 *   git clone --depth 1 https://github.com/Mayandev/notion-avatar.git /tmp/na
 *   node scripts/avatar/import-noto.mjs /tmp/na
 *
 * Qué hace con cada SVG (lienzo 1080×1080, sin cambiar el dibujo):
 *   - quita <svg>, <title>, <desc> e ids decorativos (los de <mask> se
 *     conservan, con prefijo propio para no chocar entre piezas);
 *   - normaliza los colores a #000 / #fff (había un #0C0C0C);
 *   - colapsa espacios.
 * El catálogo se genera por ORDEN NUMÉRICO del archivo (0.svg, 1.svg…): ese
 * índice es el que se guarda en la base, así que NUNCA reordenar.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const origen = process.argv[2];
if (!origen) {
  console.error('Uso: node scripts/avatar/import-noto.mjs <ruta-a-notion-avatar>');
  process.exit(1);
}
const base = join(resolve(origen), 'public/avatar/preview');
const CATEGORIAS = ['face', 'hair', 'eyes', 'eyebrows', 'nose', 'mouth', 'beard', 'glasses', 'accessories', 'details'];

function limpiar(svg, prefijo) {
  let s = svg
    .replace(/<\?xml[^>]*>/g, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[^<]*<\/title>/g, '')
    .replace(/<desc>[^<]*<\/desc>/g, '');
  // ids de máscara: se conservan con prefijo; el resto se borra.
  const mascaras = new Set([...s.matchAll(/<mask[^>]*\sid="([^"]+)"/g)].map((m) => m[1]));
  s = s.replace(/\sid="([^"]+)"/g, (m, id) => (mascaras.has(id) ? ` id="${prefijo}${id}"` : ''));
  for (const id of mascaras) s = s.split(`url(#${id})`).join(`url(#${prefijo}${id})`);
  s = s
    .replace(/#0C0C0C\b/gi, '#000')
    .replace(/#000000\b/gi, '#000')
    .replace(/#FFFFFF\b/gi, '#fff')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/(\d+\.\d{2})\d+/g, '$1')
    .trim();
  if (/<(script|image|use|foreignObject|style)\b|on[a-z]+=|href=/i.test(s)) {
    throw new Error(`Pieza con marcado no permitido (${prefijo})`);
  }
  return s;
}

let salida =

  '// ARCHIVO GENERADO por scripts/avatar/import-noto.mjs — NO EDITAR A MANO.\n' +
  '// Piezas de "Noto avatar" de Felix Wong, licencia CC0 1.0 (dominio público),\n' +
  '// tomadas de github.com/Mayandev/notion-avatar. Ver lib/avatar/noto/LICENSE.md.\n' +
  '// Lienzo de 1080×1080. El ÍNDICE de cada arreglo es el que se guarda: no reordenar.\n\n';

for (const cat of CATEGORIAS) {
  const dir = join(base, cat);
  const archivos = readdirSync(dir)
    .filter((f) => /^\d+\.svg$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  archivos.forEach((f, i) => {
    if (parseInt(f, 10) !== i) throw new Error(`Hueco en la numeración de ${cat}: ${f}`);
  });
  const piezas = archivos.map((f) => limpiar(readFileSync(join(dir, f), 'utf8'), `n${cat[0]}${parseInt(f, 10)}`));
  salida += `export const NOTO_${cat.toUpperCase()}: readonly string[] = ${JSON.stringify(piezas, null, 0).replace(/","/g, '",\n  "').replace(/^\["/, '[\n  "').replace(/"\]$/, '",\n]')};\n\n`;
}
const destino = resolve(new URL('../../lib/avatar/noto/parts.generated.ts', import.meta.url).pathname);
writeFileSync(destino, salida);
console.log(`Escrito ${destino} (${(salida.length / 1024).toFixed(0)} KB)`);
