#!/usr/bin/env node
/**
 * Regenera el RESPALDO EMPAQUETADO de Extensiones Corporativas del Portal TH
 * (`lib/portal/extensiones-respaldo.json`) a partir del Excel de Talento Humano.
 *
 *   node scripts/portal/extensiones-respaldo.mjs <ruta/extensiones.xlsx> [hoja]
 *
 * Guarda las filas TAL CUAL vienen en el Excel (igual que las devuelve Graph
 * en `usedRange.values`); la limpieza (espacios duros, orden, encabezados) la
 * hace `lib/portal/extensiones-datos.ts`, la misma que se aplica a lo que se
 * lee de SharePoint. Así hay una sola regla de limpieza.
 *
 * El respaldo solo se usa si SharePoint nunca respondió desde que arrancó la
 * app; la fuente normal es el Excel del sitio TalentoHumano.
 */
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , ruta, hojaPedida] = process.argv;
if (!ruta) {
  console.error('Uso: node scripts/portal/extensiones-respaldo.mjs <ruta/extensiones.xlsx> [hoja]');
  process.exit(1);
}

const libro = new ExcelJS.Workbook();
await libro.xlsx.readFile(ruta);
const hoja = hojaPedida ? libro.getWorksheet(hojaPedida) : libro.worksheets[0];
if (!hoja) {
  console.error(`No existe la hoja ${hojaPedida ?? '(primera)'} en ${ruta}`);
  process.exit(1);
}

const texto = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') return v.text ?? v.result ?? (v.richText ? v.richText.map((t) => t.text).join('') : '');
  return v;
};

const valores = [];
hoja.eachRow({ includeEmpty: false }, (fila) => {
  const celdas = [];
  for (let c = 1; c <= hoja.columnCount; c++) celdas.push(texto(fila.getCell(c).value));
  valores.push(celdas);
});

const destino = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'portal', 'extensiones-respaldo.json');
const salida = { origen: basename(ruta), hoja: hoja.name, valores };
writeFileSync(destino, JSON.stringify(salida, null, 2) + '\n', 'utf8');
console.log(`Respaldo escrito: ${destino} (${valores.length} filas con encabezado, hoja ${hoja.name})`);
