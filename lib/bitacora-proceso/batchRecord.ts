import ExcelJS from 'exceljs';
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

const BORDE: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};
/** La plantilla imprime al 63 %: 12 pt en pantalla ≈ 7,5 pt en papel. */
const FUENTE = { name: 'Calibri', size: 12 };

/** Columnas de la cronología sobre las 10 columnas de la plantilla (A–J). */
const COLS = { fecha: 1, hora: 2, actividadDe: 3, actividadA: 5, operarioDe: 6, operarioA: 9, observacion: 10 } as const;

function textoVisto(o: OrdenDetalle, v: OrdenDetalle['vistos'][number]): string {
  const rol = v.rol === 'SUPERVISOR' && v.firma?.significado === OT_SIGNIFICADO_CIERRE_JEFE ? `${OT_ROL_LABEL.JEFE_PROD} (cerró)` : v.rol === 'SUPERVISOR' ? 'Supervisor (cerró)' : OT_ROL_LABEL[v.rol];
  if (v.firma) return `${rol}: ${v.firma.nombre} — ${fmtFechaHora(v.firma.firmadoEn)} (${OT_METODO_LABEL[v.firma.metodo] ?? v.firma.metodo})`;
  if (v.nota) return `${rol}: ${v.nota}`;
  if (v.estado === 'no_aplica') return `${rol}: no aplica`;
  return `${rol}: pendiente${v.designado ? ` — ${v.designado}` : ''}${o.estado === 'ABIERTA' ? ' (bitácora abierta)' : ''}`;
}

/** Genera el .xlsx: plantilla del batch record + una sección por bitácora (en orden de apertura). */
export async function buildBatchRecordXlsx(enc: BatchRecordEncabezado, ordenes: OrdenDetalle[], generado: Date = new Date()): Promise<Buffer> {
  if (ordenes.length === 0) throw new OtError('No hay bitácoras para el archivo.', 400);
  const lista = [...ordenes].sort((a, b) => a.abiertaEn.localeCompare(b.abiertaEn) || a.consecutivo - b.consecutivo);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(BATCH_RECORD_PLANTILLA_BASE64, 'base64') as unknown as ArrayBuffer);
  wb.creator = 'SynerLink';
  wb.lastModifiedBy = 'SynerLink';
  wb.created = generado;
  wb.modified = generado;
  const ws = wb.worksheets[0];

  // Encabezado del lote (filas 1–8, se repiten en cada página: print titles 1:8 de la plantilla).
  ws.getCell('B4').value = enc.producto;
  ws.getCell('F4').value = enc.concentracion;
  ws.getCell('J4').value = enc.lote;
  ws.getCell('F6').value = enc.op;
  ws.getCell('C7').value = enc.loteMp;
  const areas = [...new Set(lista.map((o) => (o.area ?? '').trim()).filter(Boolean))];
  ws.getCell('C9').value = `BITACORA DE AREA ${(areas.join(' / ') || 'ENVASE Y GRAFADO').toUpperCase()}`;

  let r = 10;
  const fila = (alto?: number) => {
    const row = ws.getRow(r);
    if (alto) row.height = alto;
    return row;
  };
  const textoAncho = (texto: string, opts: { bold?: boolean; fill?: string; size?: number } = {}) => {
    ws.mergeCells(r, 1, r, 10);
    const c = ws.getCell(r, 1);
    c.value = texto;
    c.font = { ...FUENTE, bold: Boolean(opts.bold), size: opts.size ?? FUENTE.size };
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    c.border = BORDE;
    if (opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
    // Alto según el largo (≈ 125 caracteres por línea en el ancho A–J).
    fila(Math.max(18, Math.ceil(texto.length / 125) * 16));
    r++;
  };
  const celda = (col: number, hasta: number, valor: string, bold = false, fill?: string) => {
    if (hasta > col) ws.mergeCells(r, col, r, hasta);
    const c = ws.getCell(r, col);
    c.value = valor;
    c.font = { ...FUENTE, bold };
    c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    for (let k = col; k <= hasta; k++) ws.getCell(r, k).border = BORDE;
  };

  for (const o of lista) {
    const turno = OT_TURNO_LABEL[o.turno as OtTurno] ?? o.turno;
    textoAncho(
      `Bitácora ${codigo(o.consecutivo)} · Turno ${turno} · Inicio ${fmtFechaHora(o.abiertaEn)} · Final ${o.cerradaEn ? fmtFechaHora(o.cerradaEn) : 'abierta'}${o.area ? ` · Área ${o.area}` : ''}`,
      { bold: true, fill: 'FFD9D9D9', size: 13 }
    );
    const cerro = o.cierre ? `${o.cierre.nombre}${o.cierre.como === 'JEFE_PROD' ? ' (jefe de producción)' : ''}` : 'pendiente';
    // La cuenta que registró (casi siempre la de la tablet) va una vez aquí, no en cada fila.
    const cuentas = [...new Set(o.registros.map((x) => x.usuario))];
    textoAncho(`Abrió: ${o.abiertaPor} · Cerró: ${cerro} · Jefe de producción: ${o.jefe?.name ?? '—'}${cuentas.length ? ` · Registró en SynerLink: ${cuentas.join(', ')}` : ''}`);
    if (o.operadores.length) textoAncho(`Operarios: ${o.operadores.map((x) => x.nombre).join(', ')}`);
    if (o.observacionCierre) textoAncho(`Observación de cierre: ${o.observacionCierre}`);

    celda(COLS.fecha, COLS.fecha, 'Fecha', true, 'FFF2F2F2');
    celda(COLS.hora, COLS.hora, 'Hora (servidor)', true, 'FFF2F2F2');
    celda(COLS.actividadDe, COLS.actividadA, 'Actividad', true, 'FFF2F2F2');
    celda(COLS.operarioDe, COLS.operarioA, 'Operario', true, 'FFF2F2F2');
    celda(COLS.observacion, COLS.observacion, 'Observación / texto libre', true, 'FFF2F2F2');
    fila(18);
    r++;
    if (o.registros.length === 0) {
      textoAncho('Sin registros.');
    }
    for (const reg of o.registros) {
      const quien = reg.operador ? reg.operador : reg.usuario;
      const obs = reg.observacion ? (reg.textoLibre ? `Texto libre: ${reg.observacion}` : reg.observacion) : '';
      celda(COLS.fecha, COLS.fecha, fmtFecha(reg.registradoEn));
      celda(COLS.hora, COLS.hora, fmtHora(reg.registradoEn));
      celda(COLS.actividadDe, COLS.actividadA, reg.actividad);
      celda(COLS.operarioDe, COLS.operarioA, quien);
      celda(COLS.observacion, COLS.observacion, obs);
      // Alto según el texto más largo (observación ≈ 30 caracteres por línea; actividad ≈ 48; operario ≈ 34).
      const lineas = Math.max(1, Math.ceil(obs.length / 30), Math.ceil(reg.actividad.length / 48), Math.ceil(quien.length / 34));
      fila(Math.max(17, lineas * 16));
      r++;
    }
    textoAncho(`Vistos buenos — ${o.vistos.map((v) => textoVisto(o, v)).join(' · ')}`);
    r++; // separación entre bitácoras
  }
  textoAncho(`Generado por SynerLink (Bitácora de Proceso) el ${fmtFechaHora(generado.toISOString())}. Fechas y horas del servidor, hora de Colombia. Los registros no se editan ni se borran.`, { size: 10 });

  ws.pageSetup.printArea = `A1:K${r - 1}`;
  ws.pageSetup.printTitlesRow = '1:8';
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
