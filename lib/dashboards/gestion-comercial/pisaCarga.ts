/**
 * Carga (SOLO LECTURA, en el servidor) de la base de ventas de Pisa para el
 * tablero comercial.
 *
 * Fuente: el archivo «Historico Ventas Pisa*.xlsx» MÁS RECIENTE subido a la
 * pestaña Archivos de un proyecto de SynerLink (tabla chat_project_file; el
 * contenido vive en OneDrive y se baja con downloadChatAttachment, la misma
 * función que usa la descarga de archivos de proyectos). Así, para actualizar la
 * base basta con subir la versión nueva del Excel a Archivos: no hay que tocar
 * el tablero ni desplegar.
 *
 * El libro se lee con el lector en streaming de exceljs (dependencia existente)
 * para no cargarlo completo en memoria. Se cachea por archivo (id) y se revisa
 * si hay uno más nuevo cada 10 minutos.
 */
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { prisma } from '../../prisma';
import { downloadChatAttachment } from '../../chat/attachmentStorage';
import { COLUMNAS_PISA, esExcluida, filaDesdePisa, type ColumnaPisa, type RegistroPisa } from './pisa';
import type { Fila } from './tablero';

/** Patrón del nombre del archivo en Archivos del proyecto. */
export const NOMBRE_ARCHIVO_PISA = 'Historico Ventas Pisa';
const REVISION_MS = 10 * 60_000;

export interface BasePisa {
  filas: Fila[];
  archivo: string;
  subido: string;
  /** Última fecha con datos (AAAA-MM-DD). */
  hasta: string;
}

let cache: { id: number; base: BasePisa } | null = null;
let revisado = 0;
let enCurso: Promise<BasePisa | null> | null = null;

function valorCelda(v: unknown): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text?: string }[]; text?: unknown };
    if ('result' in o) return o.result;
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text ?? '').join('');
    if ('text' in o) return o.text;
  }
  return v;
}

const normal = (v: unknown) => String(valorCelda(v) ?? '').trim();

/** Recorre el libro en streaming y devuelve las filas válidas de la hoja de ventas. */
async function leerLibro(entrada: Readable): Promise<Fila[]> {
  const Reader = (ExcelJS as unknown as {
    stream: { xlsx: { WorkbookReader: new (archivo: Readable, opciones: Record<string, string>) => AsyncIterable<unknown> } };
  }).stream.xlsx.WorkbookReader;
  const lector = new Reader(entrada, {
    sharedStrings: 'cache',
    styles: 'cache',
    hyperlinks: 'ignore',
    worksheets: 'emit',
    entries: 'emit',
  });
  const filas: Fila[] = [];
  for await (const hoja of lector) {
    let indices: Partial<Record<ColumnaPisa, number>> | null = null;
    let esVentas = false;
    let revisada = false;
    for await (const fila of hoja as AsyncIterable<{ values: unknown }>) {
      // Las hojas que no son de ventas se consumen sin procesar (el lector en
      // streaming necesita recorrer cada hoja antes de pasar a la siguiente).
      if (revisada && !esVentas) continue;
      const valores = Array.isArray(fila.values) ? (fila.values as unknown[]) : [];
      if (!indices) {
        revisada = true;
        const encabezados = valores.map(normal);
        esVentas = encabezados.includes('TOT.VENTA') && encabezados.includes('Validacion');
        if (!esVentas) continue;
        const mapa: Partial<Record<ColumnaPisa, number>> = {};
        for (const c of COLUMNAS_PISA) {
          const i = encabezados.indexOf(c);
          if (i >= 0) mapa[c] = i;
        }
        indices = mapa;
        continue;
      }
      const registro: RegistroPisa = {};
      for (const c of COLUMNAS_PISA) {
        const i = indices[c];
        if (i !== undefined) registro[c] = valorCelda(valores[i]);
      }
      if (!esExcluida(registro)) filas.push(filaDesdePisa(registro));
    }
    if (esVentas) break;
  }
  return filas;
}

async function cargar(): Promise<BasePisa | null> {
  const archivo = await prisma.chatProjectFile.findFirst({
    where: {
      file_name: { contains: NOMBRE_ARCHIVO_PISA, endsWith: '.xlsx' },
      onedrive_item_id: { not: null },
    },
    orderBy: { created_at: 'desc' },
    select: { id_project_file: true, file_name: true, onedrive_item_id: true, created_at: true },
  });
  revisado = Date.now();
  if (!archivo?.onedrive_item_id) {
    cache = null;
    return null;
  }
  if (cache && cache.id === archivo.id_project_file) return cache.base;

  const contenido = await downloadChatAttachment(archivo.onedrive_item_id);
  if (!contenido?.stream) throw new Error('No se pudo descargar la base de Pisa desde OneDrive.');
  const entrada = Readable.fromWeb(contenido.stream as unknown as Parameters<typeof Readable.fromWeb>[0]);
  const filas = await leerLibro(entrada);
  const hasta = filas.reduce((m, r) => (r.f > m ? r.f : m), '');
  const base: BasePisa = {
    filas,
    archivo: archivo.file_name,
    subido: archivo.created_at.toISOString().slice(0, 10),
    hasta,
  };
  cache = { id: archivo.id_project_file, base };
  return base;
}

/**
 * Base de Pisa vigente (ya filtrada), o null si aún no se ha subido el archivo a
 * Archivos de un proyecto. Lanza si el archivo existe pero no se puede leer.
 */
export function basePisa(): Promise<BasePisa | null> {
  if (cache && Date.now() - revisado < REVISION_MS) return Promise.resolve(cache.base);
  if (!enCurso) {
    enCurso = cargar().finally(() => {
      enCurso = null;
    });
  }
  return enCurso;
}
