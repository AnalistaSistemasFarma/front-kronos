import ExcelJS from 'exceljs';
import { SgcError } from '../sgc/errors';
import { CAMPOS_EQUIPO, ETIQUETA_CAMPO, LARGO_CAMPO, type CampoEquipo, type DatosEquipo, type ErrorCargue, type FilaCargue } from './inventario';

/**
 * Lee el inventario en el formato OLP-GCC-04-FR-017 (o cualquier Excel con esos encabezados): busca la
 * fila de encabezados (CÓDIGO INTERNO, EQUIPO, MARCA, MODELO, SERIE, CLASIFICACIÓN DE RIESGO, REGISTRO
 * SANITARIO, CLIENTE, SEDE, ZONA, CIUDAD), omite el encabezado y el pie del formato (ELABORÓ / REVISÓ /
 * APROBÓ) y marca como error las filas sin serie o sin equipo y las series repetidas.
 */

export const MAX_BYTES_CARGUE = 15 * 1024 * 1024;
export const MAX_FILAS_CARGUE = 20000;

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const ENCABEZADOS: Record<string, CampoEquipo> = {
  'CODIGO INTERNO': 'codigo_interno',
  CODIGO: 'codigo_interno',
  EQUIPO: 'equipo',
  MARCA: 'marca',
  MODELO: 'modelo',
  SERIE: 'serie',
  SERIAL: 'serie',
  'NO SERIE': 'serie',
  'CLASIFICACION DE RIESGO': 'clasificacion_riesgo',
  'CLASIFICACION RIESGO': 'clasificacion_riesgo',
  'REGISTRO SANITARIO': 'registro_sanitario',
  CLIENTE: 'cliente',
  SEDE: 'sede',
  ZONA: 'zona',
  CIUDAD: 'ciudad',
};

/** El valor de una celda como texto (número, fecha, texto enriquecido, fórmula o hipervínculo). */
export function textoCelda(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'SI' : 'NO';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return v.result === undefined || v.result === null || typeof v.result === 'object' ? '' : String(v.result);
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('error' in v) return '';
  }
  return '';
}

export async function leerInventarioXlsx(bytes: Uint8Array): Promise<{ filas: FilaCargue[]; errores: ErrorCargue[]; hoja: string }> {
  if (bytes.byteLength === 0) throw new SgcError('El archivo está vacío.', 400);
  if (bytes.byteLength > MAX_BYTES_CARGUE) throw new SgcError('El archivo debe pesar máximo 15 MB.', 400);
  // ZIP (xlsx): PK\x03\x04.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new SgcError('Cargue el inventario en Excel (.xlsx).', 400);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    throw new SgcError('No se pudo leer el Excel: verifique que sea un .xlsx válido.', 400);
  }

  for (const ws of wb.worksheets) {
    // Fila de encabezados: la primera (de las 30 primeras) que tenga EQUIPO y SERIE.
    let filaEnc = 0;
    let columnas = new Map<number, CampoEquipo>();
    for (let r = 1; r <= Math.min(30, ws.rowCount); r++) {
      const cols = new Map<number, CampoEquipo>();
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
        const campo = ENCABEZADOS[norm(textoCelda(cell.value))];
        if (campo && ![...cols.values()].includes(campo)) cols.set(c, campo);
      });
      const campos = [...cols.values()];
      if (campos.includes('equipo') && campos.includes('serie')) {
        filaEnc = r;
        columnas = cols;
        break;
      }
    }
    if (!filaEnc) continue;

    const filas: FilaCargue[] = [];
    const errores: ErrorCargue[] = [];
    const vistas = new Map<string, number>();
    for (let r = filaEnc + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const datos = Object.fromEntries(CAMPOS_EQUIPO.map((c) => [c, null])) as DatosEquipo;
      let algo = false;
      for (const [c, campo] of columnas) {
        const s = textoCelda(row.getCell(c).value).replace(/\s+/g, ' ').trim();
        if (s) {
          datos[campo] = s;
          algo = true;
        }
      }
      if (!algo) continue;
      const primera = norm(textoCelda(row.getCell(1).value));
      // Pie del formato (ELABORÓ / REVISÓ / APROBÓ / FECHA DE EMISIÓN) o encabezado repetido.
      if (/^(ELABORO|REVISO|APROBO|FECHA DE EMISION)/.test(primera) || norm(datos.serie ?? '') === 'SERIE') continue;
      if (filas.length + errores.length >= MAX_FILAS_CARGUE) throw new SgcError(`El archivo supera ${MAX_FILAS_CARGUE} filas.`, 400);
      const largos = (Object.keys(datos) as CampoEquipo[]).filter((c) => (datos[c]?.length ?? 0) > LARGO_CAMPO[c]);
      if (!datos.serie) errores.push({ fila: r, serie: null, motivo: 'Sin serie.' });
      else if (!datos.equipo) errores.push({ fila: r, serie: datos.serie, motivo: 'Sin equipo.' });
      else if (largos.length > 0) errores.push({ fila: r, serie: datos.serie, motivo: largos.map((c) => `${ETIQUETA_CAMPO[c]}: máximo ${LARGO_CAMPO[c]} caracteres`).join('; ') });
      else if (vistas.has(datos.serie.toLowerCase())) errores.push({ fila: r, serie: datos.serie, motivo: `Serie repetida (también en la fila ${vistas.get(datos.serie.toLowerCase())}).` });
      else {
        vistas.set(datos.serie.toLowerCase(), r);
        filas.push({ fila: r, datos });
      }
    }
    return { filas, errores, hoja: ws.name };
  }
  throw new SgcError('No se encontró la fila de encabezados (EQUIPO y SERIE) del inventario.', 400);
}
