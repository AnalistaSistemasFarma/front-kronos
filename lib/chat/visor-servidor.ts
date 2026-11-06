/**
 * VISORES DE ADJUNTOS DEL CHAT — la parte de servidor (2026-10-22).
 *
 *   - Conversión a PDF de Word, PowerPoint y Excel viejo con la conversión
 *     NATIVA de Microsoft Graph (`content?format=pdf`, el mismo helper que ya
 *     usa la gestión documental): sin librerías nuevas.
 *   - Las hojas de un .xlsx como tablas HTML con el MISMO motor del visor de
 *     Excel del SGC (lib/sgc/pdf/viewable.ts, PR #717), separadas por hoja
 *     para que el visor las muestre en pestañas.
 *   - Una caché en memoria de lo convertido: un adjunto del chat NO cambia
 *     (cada archivo es un item nuevo de OneDrive), así que lo convertido una
 *     vez sirve para todas las aperturas siguientes y se ahorra la ida a Graph.
 *
 * Reglas puras (qué visor le toca a cada archivo) en ./visor.ts.
 */
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { convertOneDriveItemToPdf } from '../onedrive/graphFolderUpload';
import { downloadChatAttachment } from './attachmentStorage';

/* ───────────────────────── Caché de lo convertido ───────────────────── */

/** Presupuesto total de la caché (el proceso es compartido: se mantiene chica). */
export const CACHE_VISOR_MAX_BYTES = 64 * 1024 * 1024;
/** Una entrada más grande que esto no se guarda (se convierte cada vez). */
export const CACHE_VISOR_MAX_ENTRADA = 16 * 1024 * 1024;
/** Vida de una entrada. */
export const CACHE_VISOR_TTL_MS = 30 * 60 * 1000;

interface Entrada {
  valor: Uint8Array;
  vence: number;
}

/**
 * LRU por bytes con vencimiento. Un Map conserva el orden de inserción: se
 * reinserta al leer y se expulsa por el principio. Las conversiones en vuelo
 * se comparten (dos personas abriendo el mismo Word a la vez = una sola
 * conversión en Graph).
 */
export class CacheVisor {
  private entradas = new Map<string, Entrada>();
  private enVuelo = new Map<string, Promise<Uint8Array>>();
  private bytes = 0;

  constructor(
    private readonly maxBytes = CACHE_VISOR_MAX_BYTES,
    private readonly maxEntrada = CACHE_VISOR_MAX_ENTRADA,
    private readonly ttlMs = CACHE_VISOR_TTL_MS,
    private readonly ahora: () => number = Date.now
  ) {}

  get tamano(): number {
    return this.bytes;
  }

  leer(clave: string): Uint8Array | null {
    const e = this.entradas.get(clave);
    if (!e) return null;
    if (e.vence <= this.ahora()) {
      this.quitar(clave);
      return null;
    }
    this.entradas.delete(clave);
    this.entradas.set(clave, e);
    return e.valor;
  }

  guardar(clave: string, valor: Uint8Array): void {
    if (valor.byteLength > this.maxEntrada) return;
    this.quitar(clave);
    this.entradas.set(clave, { valor, vence: this.ahora() + this.ttlMs });
    this.bytes += valor.byteLength;
    for (const [k] of this.entradas) {
      if (this.bytes <= this.maxBytes) break;
      this.quitar(k);
    }
  }

  async obtener(clave: string, producir: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const hit = this.leer(clave);
    if (hit) return hit;
    const pendiente = this.enVuelo.get(clave);
    if (pendiente) return pendiente;
    const p = producir()
      .then((v) => {
        this.guardar(clave, v);
        return v;
      })
      .finally(() => this.enVuelo.delete(clave));
    this.enVuelo.set(clave, p);
    return p;
  }

  private quitar(clave: string) {
    const e = this.entradas.get(clave);
    if (!e) return;
    this.bytes -= e.valor.byteLength;
    this.entradas.delete(clave);
  }
}

const cache = new CacheVisor();

/* ────────────────────────────── Conversiones ────────────────────────── */

/** El adjunto convertido a PDF por Microsoft Graph (con caché). */
export async function pdfDeAdjunto(onedriveItemId: string): Promise<Uint8Array> {
  return cache.obtener(`pdf:${onedriveItemId}`, async () => {
    const token = await getMicrosoftToken();
    if (!token) throw new Error('No se pudo obtener el token de Microsoft Graph');
    return new Uint8Array(await convertOneDriveItemToPdf(token, onedriveItemId));
  });
}

/** Lo que recibe el visor de Excel: una entrada por hoja y la hoja de estilos común. */
export interface HojasDeExcel {
  hojas: { nombre: string; html: string }[];
  css: string;
  /**
   * Fórmulas SIN valor calculado guardado (2026-10-24). El motor de hojas
   * toma el valor que Excel dejó en el archivo; un libro generado por un
   * programa (openpyxl, el que usan los agentes) trae la fórmula pero no el
   * resultado, y esas celdas salían EN BLANCO. Con > 0 el visor abre el PDF
   * de Microsoft (Excel Online sí recalcula) y lo avisa.
   */
  formulasSinCalcular: number;
}

/**
 * Cuántas celdas de las hojas visibles tienen fórmula y no traen el resultado
 * guardado. Recorre solo celdas con valor (exceljs no materializa las vacías).
 */
export async function contarFormulasSinCalcular(bytes: Uint8Array): Promise<number> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  let n = 0;
  for (const hoja of wb.worksheets) {
    if (hoja.state === 'hidden' || hoja.state === 'veryHidden') continue;
    hoja.eachRow({ includeEmpty: false }, (fila) => {
      fila.eachCell({ includeEmpty: false }, (celda) => {
        const v = celda.value as { formula?: unknown; sharedFormula?: unknown; result?: unknown } | null;
        if (v && typeof v === 'object' && (v.formula !== undefined || v.sharedFormula !== undefined) && (v.result === undefined || v.result === null)) n++;
      });
    });
  }
  return n;
}

const MARCA_HOJA = '<h2 class="sgc-hoja-nombre';

/**
 * Parte el HTML de xlsxToSheet (todas las hojas seguidas, cada una con su
 * `<h2 class="sgc-hoja-nombre…">`) en una entrada por hoja. El nombre de la
 * hoja y el texto de las celdas llegan ESCAPADOS, así que la marca solo puede
 * venir del propio generador.
 */
export function partirHojas(html: string): { nombre: string; html: string }[] {
  const trozos = html.split(MARCA_HOJA).slice(1);
  return trozos.map((t) => {
    const completo = MARCA_HOJA + t;
    const nombre = /^<h2 class="sgc-hoja-nombre[^"]*">([\s\S]*?)<\/h2>/.exec(completo)?.[1] ?? 'Hoja';
    const desescapado = nombre
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    // El nombre va en la pestaña: en el cuerpo sobra.
    return { nombre: desescapado, html: completo.replace(/^<h2 class="sgc-hoja-nombre[^"]*">[\s\S]*?<\/h2>/, '') };
  });
}

async function bytesDeGraph(onedriveItemId: string): Promise<Uint8Array> {
  const contenido = await downloadChatAttachment(onedriveItemId);
  if (!contenido?.stream) throw new Error('No se pudo recuperar el archivo de OneDrive');
  return new Uint8Array(await new Response(contenido.stream).arrayBuffer());
}

/**
 * Las hojas de un libro ya descargado. Si exceljs no puede leer el original
 * (los libros que generan los agentes con openpyxl, ver ./xlsx-reparar.ts),
 * lo intenta con una copia reparada; si tampoco, lanza el error ORIGINAL y la
 * ruta responde 422 para que el visor caiga al PDF.
 */
export async function leerHojasDeExcel(bytes: Uint8Array): Promise<HojasDeExcel & { reparado: boolean }> {
  const { xlsxToSheet } = await import('../sgc/pdf/viewable');
  let libro = bytes;
  let reparado = false;
  let hoja: Awaited<ReturnType<typeof xlsxToSheet>>;
  try {
    hoja = await xlsxToSheet(libro);
  } catch (error) {
    const { repararXlsxParaExceljs } = await import('./xlsx-reparar');
    const copia = await repararXlsxParaExceljs(bytes).catch(() => null);
    if (!copia?.cambios) throw error;
    try {
      hoja = await xlsxToSheet(copia.bytes);
    } catch {
      throw error;
    }
    libro = copia.bytes;
    reparado = true;
  }
  // Contar es un extra: si falla, se muestran las hojas como siempre.
  const formulasSinCalcular = await contarFormulasSinCalcular(libro).catch(() => 0);
  return { hojas: partirHojas(hoja.html), css: hoja.css, formulasSinCalcular, reparado };
}

/** Las hojas de un .xlsx (con caché). Lanza si el libro no se puede leer. */
export async function hojasDeAdjunto(onedriveItemId: string): Promise<HojasDeExcel> {
  const json = await cache.obtener(`hojas:${onedriveItemId}`, async () => {
    const { reparado, ...salida } = await leerHojasDeExcel(await bytesDeGraph(onedriveItemId));
    if (reparado) console.info(`[chat/visor] Excel ${onedriveItemId} leído con la copia reparada (formato de openpyxl)`);
    return new TextEncoder().encode(JSON.stringify(salida satisfies HojasDeExcel));
  });
  return JSON.parse(new TextDecoder().decode(json)) as HojasDeExcel;
}
