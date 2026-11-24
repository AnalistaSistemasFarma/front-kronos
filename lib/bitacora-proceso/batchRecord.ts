import JSZip from 'jszip';
import { OT_LIMITS, OT_METODO_LABEL, OT_ROL_LABEL, OT_SIGNIFICADO_CIERRE_JEFE, OT_TURNO_LABEL, type OtTurno } from './constants';
import type { OrdenDetalle } from './db';
import { OtError } from './rules';
import { BATCH_RECORD_PLANTILLA_BASE64 } from './batchRecordPlantilla';

/**
 * EXCEL DEL BATCH RECORD (reunión de mejoras con Farmalógica, 2026-11-24). La bitácora se
 * descarga sobre la plantilla del batch record (GMF-03-FR-003-16): el encabezado del lote
 * (producto, concentración, lote, OP y lote de materia prima) se repite en cada página y la
 * cronología va debajo, para imprimirla sin ajustar nada a mano. Un lote tiene varias
 * bitácoras (una por turno): se pueden juntar todas en el mismo archivo.
 *
 * Concentración y lote de materia prima NO están en la bitácora ni en un campo limpio de SAP:
 * se SUGIEREN (concentración desde la descripción del producto; lote de MP desde las
 * observaciones de la OP) y la persona los confirma o corrige en la vista previa.
 */

/** Máximo de bitácoras por archivo (un lote rara vez pasa de un mes de turnos). */
export const BATCH_RECORD_MAX_BITACORAS = 45;
const MAX_CAMPO = 120;

export interface BatchRecordEncabezado {
  producto: string;
  concentracion: string;
  lote: string;
  op: string;
  loteMp: string;
}

export interface BatchRecordInput extends BatchRecordEncabezado {
  /** Bitácoras a incluir (todas del mismo lote y empresa). */
  ids: number[];
}

/** «MEROPENEM 500 mg» → «500 mg». Reconoce mg, g, mcg, µg, UI, mL y % (con decimales y «/»). */
export function sugerirConcentracion(producto: string | null | undefined): string {
  if (!producto) return '';
  // Dos pasos con expresiones simples (sin cuantificadores anidados): la dosis y, si sigue, «/volumen».
  const base = /(\d[\d.,]*) ?(mg|g|mcg|µg|ug|UI|mL|ml|%)(?![\p{L}])/iu.exec(producto);
  if (!base) return '';
  const resto = producto.slice(base.index + base[0].length);
  const porVolumen = /^ ?\/ ?(\d[\d.,]*) ?(mL|ml|g|mg)(?![\p{L}])/iu.exec(resto);
  return `${base[1]} ${base[2]}${porVolumen ? `/${porVolumen[1]} ${porVolumen[2]}` : ''}`;
}

/**
 * Lote(s) de materia prima desde las observaciones de la OP de SAP. Farmalógica las escribe así:
 * «0629MP15596 - 8MT2606117-(9.8300)», una línea por dispensación: código interno, lote y
 * cantidad. Devuelve los lotes distintos, separados por « / ».
 */
export function sugerirLoteMp(remarks: string | null | undefined): string {
  if (!remarks) return '';
  const lotes: string[] = [];
  for (const linea of remarks.split(/[\r\n]+/)) {
    const m = linea.match(/^\s*[A-Z0-9]+\s*-\s*([A-Z0-9][A-Z0-9.\-/]*?)\s*-\s*\(/i);
    if (m && !lotes.includes(m[1])) lotes.push(m[1]);
  }
  return lotes.join(' / ');
}

function campo(v: unknown, nombre: string): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new OtError(`${nombre}: valor no válido.`, 400);
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (s.length > MAX_CAMPO) throw new OtError(`${nombre}: máximo ${MAX_CAMPO} caracteres.`, 400);
  return s;
}

/** POST { ids, producto, concentracion, lote, op, loteMp }: el encabezado lo confirma la persona. */
export function parseBatchRecordInput(body: Record<string, unknown> | null, idBase: number): BatchRecordInput {
  if (!body) throw new OtError('Se esperaba un JSON con el encabezado del batch record.', 400);
  const raw = Array.isArray(body.ids) ? body.ids : [idBase];
  const ids = [...new Set([idBase, ...raw.map((x) => Number(x))])];
  if (ids.some((n) => !Number.isInteger(n) || n < 1)) throw new OtError('Bitácoras: valor no válido.', 400);
  if (ids.length > BATCH_RECORD_MAX_BITACORAS) throw new OtError(`Máximo ${BATCH_RECORD_MAX_BITACORAS} bitácoras por archivo.`, 400);
  const producto = campo(body.producto, 'Producto');
  if (!producto) throw new OtError('Falta el producto.', 400);
  const lote = campo(body.lote, 'Lote');
  if (!lote) throw new OtError('Falta el lote.', 400);
  return {
    ids,
    producto: producto.slice(0, OT_LIMITS.producto),
    concentracion: campo(body.concentracion, 'Concentración'),
    lote,
    op: campo(body.op, 'O.P.'),
    loteMp: campo(body.loteMp, 'Lote de materia prima'),
  };
}

/** Las bitácoras de un archivo deben ser del mismo lote (el encabezado es uno solo). */
export function assertMismoLote(ordenes: ReadonlyArray<Pick<OrdenDetalle, 'lote' | 'consecutivo'>>): void {
  const lotes = new Set(ordenes.map((o) => o.lote.trim().toUpperCase()));
  if (lotes.size > 1) throw new OtError('Todas las bitácoras del archivo deben ser del mismo lote.', 400);
}

const TZ = 'America/Bogota';
const fmtFecha = (iso: string) => new Intl.DateTimeFormat('es-CO', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const fmtHora = (iso: string) => new Intl.DateTimeFormat('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));
const fmtFechaHora = (iso: string) => `${fmtFecha(iso)} ${fmtHora(iso).slice(0, 5)}`;
const codigo = (n: number) => `BP-${String(n).padStart(4, '0')}`;

/** Nombre sugerido del archivo: BatchRecord_<lote>_<BP inicial>[-<BP final>].xlsx (sin caracteres raros). */
export function nombreArchivoBatchRecord(lote: string, consecutivos: number[]): string {
  const ord = [...consecutivos].sort((a, b) => a - b);
  const rango = ord.length > 1 ? `${codigo(ord[0])}-${codigo(ord[ord.length - 1])}` : codigo(ord[0] ?? 0);
  return `BatchRecord_${lote.replace(/[^A-Za-z0-9_-]+/g, '') || 'lote'}_${rango}.xlsx`;
}

/** Columnas de la cronología sobre las 10 columnas de la plantilla (A–J). */
const COLS = { fecha: 1, hora: 2, actividadDe: 3, actividadA: 5, operarioDe: 6, operarioA: 9, observacion: 10 } as const;

function textoVisto(o: OrdenDetalle, v: OrdenDetalle['vistos'][number]): string {
  const rol = v.rol === 'SUPERVISOR' && v.firma?.significado === OT_SIGNIFICADO_CIERRE_JEFE ? `${OT_ROL_LABEL.JEFE_PROD} (cerró)` : v.rol === 'SUPERVISOR' ? 'Supervisor (cerró)' : OT_ROL_LABEL[v.rol];
  if (v.firma) return `${rol}: ${v.firma.nombre} — ${fmtFechaHora(v.firma.firmadoEn)} (${OT_METODO_LABEL[v.firma.metodo] ?? v.firma.metodo})`;
  if (v.nota) return `${rol}: ${v.nota}`;
  if (v.estado === 'no_aplica') return `${rol}: no aplica`;
  return `${rol}: pendiente${v.designado ? ` — ${v.designado}` : ''}${o.estado === 'ABIERTA' ? ' (bitácora abierta)' : ''}`;
}

// ---------------------------------------------------------------------------
// Generación por XML (2026-11-24, Nicolás: «aprende del SGC para que no se dañe el formato»).
// Como el SGC (lib/sgc/pdf/officePdf.ts, prepareXlsxForMicrosoft), la plantilla NO pasa por una
// librería que la lea y la reescriba: se abre el .xlsx con JSZip y solo se tocan, en su XML, las
// celdas del encabezado, las filas nuevas desde la 10, sus estilos (se AGREGAN al final de
// styles.xml), las celdas combinadas y el área de impresión. Logo, estilos, filas 1–9, títulos
// que se repiten en cada página y configuración de página quedan byte a byte como en Excel.
// ---------------------------------------------------------------------------

const SHEET = 'xl/worksheets/sheet1.xml';
const STYLES = 'xl/styles.xml';
const WORKBOOK = 'xl/workbook.xml';

/** Escapa texto para XML y quita caracteres de control que Excel no acepta. */
export function xmlTexto(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colLetra(n: number): string {
  return String.fromCharCode(64 + n); // A–K: basta una letra
}

/** Agrega un elemento al final de una colección de styles.xml (<fonts count="n">…) y devuelve su índice. */
function agregarEstilo(styles: string, coleccion: 'fonts' | 'fills' | 'borders' | 'cellXfs', xml: string): { styles: string; indice: number } {
  // eslint-disable-next-line security/detect-non-literal-regexp -- `coleccion` es una de cuatro constantes del código
  const re = new RegExp(`<${coleccion} count="(\\d+)"([^>]*)>([\\s\\S]*?)</${coleccion}>`);
  const m = re.exec(styles);
  if (!m) throw new Error(`La plantilla no tiene <${coleccion}> en styles.xml`);
  const indice = Number(m[1]);
  return { styles: styles.replace(re, `<${coleccion} count="${indice + 1}"${m[2]}>${m[3]}${xml}</${coleccion}>`), indice };
}

interface EstilosBitacora {
  seccion: number;
  linea: number;
  encabezadoTabla: number;
  celda: number;
  pie: number;
}

/** Estilos propios de la bitácora (Calibri, borde fino, ajuste de texto), agregados sin tocar los de la plantilla. */
function agregarEstilosBitacora(styles: string): { styles: string; estilos: EstilosBitacora } {
  let s = styles;
  const fuente = (sz: number, bold: boolean) => {
    const r = agregarEstilo(s, 'fonts', `<font>${bold ? '<b/>' : ''}<sz val="${sz}"/><name val="Calibri"/><family val="2"/></font>`);
    s = r.styles;
    return r.indice;
  };
  const relleno = (argb: string) => {
    const r = agregarEstilo(s, 'fills', `<fill><patternFill patternType="solid"><fgColor rgb="${argb}"/><bgColor indexed="64"/></patternFill></fill>`);
    s = r.styles;
    return r.indice;
  };
  const fNormal = fuente(12, false);
  const fNegrita = fuente(12, true);
  const fSeccion = fuente(13, true);
  const fPie = fuente(10, false);
  const gris = relleno('FFD9D9D9');
  const grisClaro = relleno('FFF2F2F2');
  const b = agregarEstilo(s, 'borders', '<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>');
  s = b.styles;
  const xf = (font: number, fill: number, vertical: 'center' | 'top') => {
    const r = agregarEstilo(
      s,
      'cellXfs',
      `<xf numFmtId="49" fontId="${font}" fillId="${fill}" borderId="${b.indice}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="${vertical}" wrapText="1"/></xf>`
    );
    s = r.styles;
    return r.indice;
  };
  // Primero se agregan los formatos y DESPUÉS se devuelve el styles.xml que ya los tiene.
  const estilos: EstilosBitacora = {
    seccion: xf(fSeccion, gris, 'center'),
    linea: xf(fNormal, 0, 'center'),
    encabezadoTabla: xf(fNegrita, grisClaro, 'center'),
    celda: xf(fNormal, 0, 'top'),
    pie: xf(fPie, 0, 'center'),
  };
  return { styles: s, estilos };
}

/** Pone un texto en una celda que YA existe en la plantilla (conserva su estilo `s`). */
export function ponerTextoCelda(sheet: string, ref: string, texto: string): string {
  // La celda puede venir vacía (<c r="B4" s="113"/>) o con valor (<c r="C9" s="102" t="s"><v>0</v></c>).
  // eslint-disable-next-line security/detect-non-literal-regexp -- `ref` es una celda fija del código (B4, F4, J4, F6, C7, C9)
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = re.exec(sheet);
  if (!m) throw new Error(`La plantilla no tiene la celda ${ref}`);
  const estilo = / s="\d+"/.exec(m[1])?.[0] ?? '';
  return sheet.replace(re, `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${xmlTexto(texto)}</t></is></c>`);
}

interface FilaNueva {
  alto: number;
  celdas: Array<{ desde: number; hasta: number; texto: string; estilo: number }>;
}

/** XML de una fila: cada celda del rango combinado lleva el estilo (para que el borde salga completo). */
function filaXml(n: number, f: FilaNueva): { xml: string; merges: string[] } {
  const celdas: string[] = [];
  const merges: string[] = [];
  for (const c of f.celdas) {
    for (let k = c.desde; k <= c.hasta; k++) {
      const ref = `${colLetra(k)}${n}`;
      celdas.push(k === c.desde && c.texto ? `<c r="${ref}" s="${c.estilo}" t="inlineStr"><is><t xml:space="preserve">${xmlTexto(c.texto)}</t></is></c>` : `<c r="${ref}" s="${c.estilo}"/>`);
    }
    if (c.hasta > c.desde) merges.push(`${colLetra(c.desde)}${n}:${colLetra(c.hasta)}${n}`);
  }
  return { xml: `<row r="${n}" spans="1:10" ht="${f.alto}" customHeight="1">${celdas.join('')}</row>`, merges };
}

/** Filas de la bitácora (desde la 10): una sección por bitácora, en orden de apertura. */
export function filasBitacora(ordenes: OrdenDetalle[], e: EstilosBitacora, generado: Date): FilaNueva[] {
  const filas: FilaNueva[] = [];
  const ancho = (texto: string, estilo: number, porLinea = 125, minimo = 18) =>
    filas.push({ alto: Math.max(minimo, Math.ceil(texto.length / porLinea) * 16), celdas: [{ desde: 1, hasta: 10, texto, estilo }] });
  for (const o of ordenes) {
    const turno = OT_TURNO_LABEL[o.turno as OtTurno] ?? o.turno;
    ancho(`Bitácora ${codigo(o.consecutivo)} · Turno ${turno} · Inicio ${fmtFechaHora(o.abiertaEn)} · Final ${o.cerradaEn ? fmtFechaHora(o.cerradaEn) : 'abierta'}${o.area ? ` · Área ${o.area}` : ''}`, e.seccion, 110, 20);
    const cerro = o.cierre ? `${o.cierre.nombre}${o.cierre.como === 'JEFE_PROD' ? ' (jefe de producción)' : ''}` : 'pendiente';
    // La cuenta que registró (casi siempre la de la tablet) va una vez aquí, no en cada fila.
    const cuentas = [...new Set(o.registros.map((x) => x.usuario))];
    ancho(`Abrió: ${o.abiertaPor} · Cerró: ${cerro} · Jefe de producción: ${o.jefe?.name ?? '—'}${cuentas.length ? ` · Registró en SynerLink: ${cuentas.join(', ')}` : ''}`, e.linea);
    if (o.operadores.length) ancho(`Operarios: ${o.operadores.map((x) => x.nombre).join(', ')}`, e.linea);
    if (o.observacionCierre) ancho(`Observación de cierre: ${o.observacionCierre}`, e.linea);
    filas.push({
      alto: 18,
      celdas: [
        { desde: COLS.fecha, hasta: COLS.fecha, texto: 'Fecha', estilo: e.encabezadoTabla },
        { desde: COLS.hora, hasta: COLS.hora, texto: 'Hora (servidor)', estilo: e.encabezadoTabla },
        { desde: COLS.actividadDe, hasta: COLS.actividadA, texto: 'Actividad', estilo: e.encabezadoTabla },
        { desde: COLS.operarioDe, hasta: COLS.operarioA, texto: 'Operario', estilo: e.encabezadoTabla },
        { desde: COLS.observacion, hasta: COLS.observacion, texto: 'Observación / texto libre', estilo: e.encabezadoTabla },
      ],
    });
    if (o.registros.length === 0) ancho('Sin registros.', e.linea);
    for (const reg of o.registros) {
      const quien = reg.operador ?? reg.usuario;
      const obs = reg.observacion ? (reg.textoLibre ? `Texto libre: ${reg.observacion}` : reg.observacion) : '';
      // Alto según el texto más largo (observación ≈ 30 caracteres por línea; actividad ≈ 48; operario ≈ 34).
      const lineas = Math.max(1, Math.ceil(obs.length / 30), Math.ceil(reg.actividad.length / 48), Math.ceil(quien.length / 34));
      filas.push({
        alto: Math.max(17, lineas * 16),
        celdas: [
          { desde: COLS.fecha, hasta: COLS.fecha, texto: fmtFecha(reg.registradoEn), estilo: e.celda },
          { desde: COLS.hora, hasta: COLS.hora, texto: fmtHora(reg.registradoEn), estilo: e.celda },
          { desde: COLS.actividadDe, hasta: COLS.actividadA, texto: reg.actividad, estilo: e.celda },
          { desde: COLS.operarioDe, hasta: COLS.operarioA, texto: quien, estilo: e.celda },
          { desde: COLS.observacion, hasta: COLS.observacion, texto: obs, estilo: e.celda },
        ],
      });
    }
    ancho(`Vistos buenos — ${o.vistos.map((v) => textoVisto(o, v)).join(' · ')}`, e.linea);
    filas.push({ alto: 9, celdas: [] }); // separación entre bitácoras
  }
  ancho(`Generado por SynerLink (Bitácora de Proceso) el ${fmtFechaHora(generado.toISOString())}. Fechas y horas del servidor, hora de Colombia. Los registros no se editan ni se borran.`, e.pie, 150);
  return filas;
}

/** Genera el .xlsx sobre la plantilla del batch record (edición del XML; ver arriba). */
export async function buildBatchRecordXlsx(enc: BatchRecordEncabezado, ordenes: OrdenDetalle[], generado: Date = new Date()): Promise<Buffer> {
  if (ordenes.length === 0) throw new OtError('No hay bitácoras para el archivo.', 400);
  const lista = [...ordenes].sort((a, b) => a.abiertaEn.localeCompare(b.abiertaEn) || a.consecutivo - b.consecutivo);
  const zip = await JSZip.loadAsync(Buffer.from(BATCH_RECORD_PLANTILLA_BASE64, 'base64'));
  const leer = async (p: string) => {
    const f = zip.file(p);
    if (!f) throw new Error(`La plantilla no tiene ${p}`);
    return f.async('string');
  };
  const { styles, estilos } = agregarEstilosBitacora(await leer(STYLES));
  let sheet = await leer(SHEET);

  // Encabezado del lote (filas 1–8: Excel las repite en cada página por los títulos de impresión de la plantilla).
  sheet = ponerTextoCelda(sheet, 'B4', enc.producto);
  sheet = ponerTextoCelda(sheet, 'F4', enc.concentracion);
  sheet = ponerTextoCelda(sheet, 'J4', enc.lote);
  sheet = ponerTextoCelda(sheet, 'F6', enc.op);
  sheet = ponerTextoCelda(sheet, 'C7', enc.loteMp);
  const areas = [...new Set(lista.map((o) => (o.area ?? '').trim()).filter(Boolean))];
  sheet = ponerTextoCelda(sheet, 'C9', `BITACORA DE AREA ${(areas.join(' / ') || 'ENVASE Y GRAFADO').toUpperCase()}`);

  // Filas nuevas desde la 10, con sus celdas combinadas.
  const filas = filasBitacora(lista, estilos, generado);
  const xmlFilas: string[] = [];
  const merges: string[] = [];
  filas.forEach((f, i) => {
    const r = filaXml(10 + i, f);
    xmlFilas.push(r.xml);
    merges.push(...r.merges);
  });
  const ultima = 9 + filas.length;
  sheet = sheet.replace('</sheetData>', `${xmlFilas.join('')}</sheetData>`);
  sheet = sheet.replace(/<mergeCells count="(\d+)">([\s\S]*?)<\/mergeCells>/, (_m, n: string, body: string) => {
    return `<mergeCells count="${Number(n) + merges.length}">${body}${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`;
  });
  sheet = sheet.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:K${ultima}"/>`);

  // Área de impresión hasta la última fila; los títulos que se repiten (1:8) quedan como en la plantilla.
  const workbook = (await leer(WORKBOOK)).replace(/(<definedName name="_xlnm\.Print_Area"[^>]*>[^<]*?\$A\$1:\$K\$)\d+(<\/definedName>)/, `$1${ultima}$2`);

  zip.file(SHEET, sheet);
  zip.file(STYLES, styles);
  zip.file(WORKBOOK, workbook);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
