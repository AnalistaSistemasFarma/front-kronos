/**
 * REPARAR UN .XLSX DE OPENPYXL PARA EXCELJS (2026-10-26).
 *
 * Reporte de Nicolás Rivera (2026-10-26, 14:40 COT): «estoy teniendo bugs
 * constantes con la previsualización del chat». En los logs de producción,
 * casi todos los Excel que fallaban en «Hojas» (respuesta 422) los generaron
 * los agentes con openpyxl («Microsoft Excel Compatible / Openpyxl 3.1.5»).
 * exceljs 4.4 no lee tres cosas que openpyxl escribe distinto a Excel:
 *
 *   1. Relaciones con ruta ABSOLUTA (`Target="/xl/tables/table1.xml"`): exceljs
 *      busca las tablas, comentarios y dibujos por la ruta RELATIVA
 *      (`../tables/table1.xml`), no las encuentra y revienta con
 *      «Cannot read properties of undefined (reading 'name')».
 *   2. Dibujos (gráficos e imágenes) con el espacio de nombres POR DEFECTO
 *      (`<wsDr xmlns="…spreadsheetDrawing">`) en vez del prefijo `xdr:`:
 *      exceljs no reconoce la etiqueta, el dibujo queda vacío y revienta con
 *      «… (reading 'anchors')».
 *   3. Comentarios en `xl/comments/comment1.xml` (Excel los deja en
 *      `xl/comments1.xml`): revienta con «… (reading 'comments')». El visor no
 *      muestra comentarios, así que se quitan de la COPIA que lee el visor.
 *
 * Todo se hace sobre una copia en memoria SOLO para el visor; el archivo del
 * chat no se toca. Se usa únicamente cuando exceljs ya falló con el original
 * (un libro que se lee bien no pasa por aquí).
 */
import JSZip from 'jszip';

const NS_DIBUJO = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const REL_COMENTARIOS = 'relationships/comments';
const REL_VML = 'relationships/vmlDrawing';

/** Directorio (sin barra final) de la parte a la que pertenece un archivo .rels. */
function origenDeRels(nombreRels: string): string {
  // xl/worksheets/_rels/sheet1.xml.rels → xl/worksheets ; _rels/.rels → ''
  const dirRels = nombreRels.slice(0, nombreRels.lastIndexOf('/'));
  const i = dirRels.lastIndexOf('/');
  return i === -1 ? '' : dirRels.slice(0, i);
}

/** Ruta relativa POSIX de `destino` vista desde el directorio `desde` (ambas sin barra inicial). */
export function rutaRelativa(desde: string, destino: string): string {
  const a = desde ? desde.split('/') : [];
  const b = destino.split('/');
  let comun = 0;
  while (comun < a.length && comun < b.length - 1 && a[comun] === b[comun]) comun++;
  return [...Array(a.length - comun).fill('..'), ...b.slice(comun)].join('/');
}

/** Cambia los `Target="/…"` internos de un .rels por rutas relativas a su parte. */
export function relsConRutasRelativas(xml: string, nombreRels: string): string {
  const origen = origenDeRels(nombreRels);
  return xml.replace(/<Relationship\b[^>]*>/g, (rel) => {
    if (/TargetMode="External"/.test(rel)) return rel;
    return rel.replace(/\bTarget="\/([^"]+)"/, (_t, ruta: string) => `Target="${rutaRelativa(origen, ruta)}"`);
  });
}

/** Quita de un .rels de hoja las relaciones de comentarios y su dibujo VML. */
function relsSinComentarios(xml: string): { xml: string; quitados: number } {
  let quitados = 0;
  const limpio = xml.replace(/<Relationship\b[^>]*\/>/g, (rel) => {
    if (rel.includes(REL_COMENTARIOS) || rel.includes(REL_VML)) {
      quitados++;
      return '';
    }
    return rel;
  });
  return { xml: limpio, quitados };
}

/**
 * Un dibujo con el espacio de nombres por defecto pasa a usar el prefijo
 * `xdr:` (lo único que exceljs reconoce). Las etiquetas SIN prefijo de ese
 * archivo son justamente las de ese espacio; las de otros (a:, c:, r:) ya
 * vienen con el suyo y no se tocan.
 */
export function dibujoConPrefijoXdr(xml: string): string {
  const raiz = /<wsDr\b[^>]*\sxmlns="([^"]+)"/.exec(xml);
  if (!raiz || raiz[1] !== NS_DIBUJO) return xml;
  return xml
    .replace(/<(\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g, '<$1xdr:$2')
    .replace(/(<xdr:wsDr\b[^>]*?)\sxmlns="[^"]+"/, `$1 xmlns:xdr="${NS_DIBUJO}"`);
}

/**
 * Devuelve una copia del libro que exceljs sí puede leer (ver arriba). Si el
 * libro no trae nada de eso, devuelve los mismos bytes.
 */
export async function repararXlsxParaExceljs(bytes: Uint8Array): Promise<{ bytes: Uint8Array; cambios: number }> {
  const zip = await JSZip.loadAsync(bytes);
  let cambios = 0;
  for (const nombre of Object.keys(zip.files)) {
    const archivo = zip.files[nombre];
    if (archivo.dir) continue;
    if (nombre.endsWith('.rels')) {
      const original = await archivo.async('string');
      let xml = relsConRutasRelativas(original, nombre);
      if (/^xl\/worksheets\/_rels\//.test(nombre)) {
        const r = relsSinComentarios(xml);
        xml = r.xml;
      }
      if (xml !== original) {
        zip.file(nombre, xml);
        cambios++;
      }
    } else if (/^xl\/worksheets\/[^/]+\.xml$/.test(nombre)) {
      const original = await archivo.async('string');
      // Sin la relación del VML, la etiqueta que la apunta sobra.
      const xml = original.replace(/<legacyDrawing\b[^>]*\/>/g, '');
      if (xml !== original) {
        zip.file(nombre, xml);
        cambios++;
      }
    } else if (/^xl\/drawings\/[^/]+\.xml$/.test(nombre)) {
      const original = await archivo.async('string');
      const xml = dibujoConPrefijoXdr(original);
      if (xml !== original) {
        zip.file(nombre, xml);
        cambios++;
      }
    } else if (/^xl\/comments\//.test(nombre) || /^xl\/drawings\/[^/]+\.vml$/.test(nombre)) {
      // Comentarios y su VML: el visor no los muestra.
      zip.remove(nombre);
      cambios++;
    }
  }
  if (!cambios) return { bytes, cambios };
  return { bytes: await zip.generateAsync({ type: 'uint8array' }), cambios };
}
