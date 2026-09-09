/**
 * PORTAL DE TALENTO HUMANO — lectura del contenido desde SharePoint.
 *
 * Habla con el conector `mcp-sharepoint-gss` por MCP sobre HTTP (transporte
 * "streamable-http", sin sesión). No se llama a Microsoft Graph directamente
 * porque las credenciales de este front son del tenant de Farmalógica y el
 * sitio de Talento Humano vive en el de GSS — ver la nota de `config.ts`.
 *
 * Todo lo de aquí es de SOLO LECTURA: el conector no expone ninguna
 * herramienta de escritura, así que el portal no puede alterar el SharePoint
 * ni por error ni por un fallo.
 */
import ExcelJS from 'exceljs';
import {
  ARCHIVO_EXCEPCIONES,
  CARPETA_BANNERS,
  CARPETA_DOCUMENTOS,
  CARPETA_IMAGENES,
  CONECTOR_SHAREPOINT_GSS,
  EXCEPCIONES_CACHE_MS,
  SITIO_TH,
} from './config';

/** Un archivo tal como lo devuelve el conector. */
interface ArchivoSp {
  name: string;
  tipo: 'archivo' | 'carpeta';
  size: number;
  modificado: string;
  webUrl: string;
}

/** Un documento del portal, ya emparejado con su portada. */
export interface DocumentoPortal {
  /** Nombre sin extensión: es el título que se muestra. */
  titulo: string;
  /** Ruta dentro de la biblioteca, para pedirlo por el endpoint del portal. */
  ruta: string;
  tamano: number;
  modificado: string;
  /** Ruta de la portada, o null si no tiene. */
  portada: string | null;
}

export interface BannerPortal {
  titulo: string;
  ruta: string;
  modificado: string;
}

export interface ContenidoPortal {
  documentos: DocumentoPortal[];
  banners: BannerPortal[];
}

let contadorLlamadas = 0;

/**
 * Llama una herramienta del conector.
 *
 * El conector responde en formato SSE (`data: {...}`) aunque sea una sola
 * respuesta, así que hay que sacar el JSON de ahí.
 */
async function llamarConector(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(CONECTOR_SHAREPOINT_GSS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++contadorLlamadas,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`conector ${tool}: HTTP ${res.status}`);

  const texto = await res.text();
  const linea = texto
    .split('\n')
    .map((l) => l.replace(/^data:\s*/, '').trim())
    .find((l) => l.startsWith('{'));
  if (!linea) throw new Error(`conector ${tool}: respuesta vacía`);

  const sobre = JSON.parse(linea) as {
    error?: { message?: string };
    result?: { content?: { type: string; text?: string }[]; isError?: boolean };
  };
  if (sobre.error) throw new Error(`conector ${tool}: ${sobre.error.message ?? 'error'}`);

  const bloque = sobre.result?.content?.find((c) => c.type === 'text')?.text ?? '';
  if (sobre.result?.isError) throw new Error(`conector ${tool}: ${bloque.slice(0, 200)}`);
  return bloque ? JSON.parse(bloque) : null;
}

/** Lista una carpeta de la biblioteca del sitio. Carpeta inexistente = vacía. */
async function listarCarpeta(ruta: string): Promise<ArchivoSp[]> {
  try {
    const data = (await llamarConector('sharepoint_browse_folder', {
      driveName: `site:${SITIO_TH}`,
      path: ruta,
    })) as { items?: ArchivoSp[] } | null;
    return (data?.items ?? []).filter((i) => i.tipo === 'archivo');
  } catch (error) {
    // Una carpeta que todavía no existe —BANNERS, por ejemplo, hasta que
    // Talento Humano la cree— no es un fallo del portal: es que no hay nada
    // que mostrar. Lo que sí se registra, para que no pase inadvertido.
    console.warn(`[portal] no se pudo leer la carpeta "${ruta}":`, (error as Error).message);
    return [];
  }
}

const sinExtension = (nombre: string) => nombre.replace(/\.[^.]+$/, '');

/**
 * El contenido del portal: documentos con su portada, y banners.
 *
 * EL EMPAREJAMIENTO ES POR NOMBRE, no por una tabla en el código: si el PDF se
 * llama `Reglamento Interno de Trabajo.pdf`, su portada es
 * `Reglamento Interno de Trabajo.jpg`. Se hizo así —y se renombraron los
 * archivos el 2026-09-09— para que Talento Humano publique un documento nuevo
 * sin pedirle nada a nadie. Un documento sin portada se muestra igual, solo
 * que sin imagen.
 */
export async function leerContenido(): Promise<ContenidoPortal> {
  const [docs, imgs, banners] = await Promise.all([
    listarCarpeta(CARPETA_DOCUMENTOS),
    listarCarpeta(CARPETA_IMAGENES),
    listarCarpeta(CARPETA_BANNERS),
  ]);

  const portadaPorNombre = new Map<string, string>();
  for (const img of imgs) {
    portadaPorNombre.set(sinExtension(img.name).toLowerCase(), `${CARPETA_IMAGENES}/${img.name}`);
  }

  return {
    documentos: docs
      .filter((d) => d.name.toLowerCase().endsWith('.pdf'))
      .map((d) => ({
        titulo: sinExtension(d.name),
        ruta: `${CARPETA_DOCUMENTOS}/${d.name}`,
        tamano: d.size,
        modificado: d.modificado,
        portada: portadaPorNombre.get(sinExtension(d.name).toLowerCase()) ?? null,
      }))
      .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es')),
    banners: banners
      .filter((b) => /\.(jpe?g|png|webp|gif)$/i.test(b.name))
      .map((b) => ({
        titulo: sinExtension(b.name),
        ruta: `${CARPETA_BANNERS}/${b.name}`,
        modificado: b.modificado,
      }))
      // Lo más reciente primero: un anuncio nuevo tiene que verse de entrada.
      .sort((a, b) => b.modificado.localeCompare(a.modificado)),
  };
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Saca los correos de un Excel.
 *
 * Busca primero la columna cuyo encabezado hable de correo; si no la
 * encuentra, recoge cualquier celda que parezca un correo. Es a propósito
 * tolerante: el archivo lo mantiene a mano Talento Humano y va a crecer con
 * columnas que hoy no existen —nombre, empresa, hasta cuándo—. Un lector
 * estricto se rompería el día que alguien agregue una columna, y ese día nadie
 * se acordaría de este archivo.
 */
async function correosDeExcel(binario: Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(binario as unknown as ArrayBuffer);

  const encontrados: string[] = [];
  for (const hoja of wb.worksheets) {
    // ¿Hay una columna de correo declarada en la primera fila?
    let columnaCorreo = -1;
    const cabecera = hoja.getRow(1);
    cabecera.eachCell({ includeEmpty: false }, (celda, col) => {
      const texto = String(celda.text ?? '').trim().toLowerCase();
      // El `!CORREO.test` no sobra: `persona@gmail.com` CONTIENE "mail", así
      // que sin esa condición una lista sin encabezado tomaba su primera fila
      // por título y se comía un correo. Lo cazó la prueba, no una revisión.
      if (columnaCorreo < 0 && !CORREO.test(texto) && (texto.includes('correo') || texto.includes('mail'))) {
        columnaCorreo = col;
      }
    });

    hoja.eachRow({ includeEmpty: false }, (fila, n) => {
      if (n === 1 && columnaCorreo > 0) return; // el encabezado no es un dato
      if (columnaCorreo > 0) {
        const valor = String(fila.getCell(columnaCorreo).text ?? '').trim().toLowerCase();
        if (CORREO.test(valor)) encontrados.push(valor);
        return;
      }
      fila.eachCell({ includeEmpty: false }, (celda) => {
        const valor = String(celda.text ?? '').trim().toLowerCase();
        if (CORREO.test(valor)) encontrados.push(valor);
      });
    });
  }
  return encontrados;
}

/** Un correo por línea; se ignoran las vacías y las que empiezan por `#`. */
function correosDeTexto(binario: Buffer): string[] {
  return binario
    .toString('utf8')
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith('#') && CORREO.test(l));
}

/**
 * Se exponen los dos parseadores SOLO para poder probarlos.
 *
 * Es lo único que de verdad se rompe aquí —la descarga la hace el conector y
 * ya está probada—, y el archivo lo mantiene a mano Talento Humano, así que su
 * forma va a cambiar con el tiempo.
 */
export const __soloParaPruebas = { correosDeExcel, correosDeTexto };

/** Memoria de corto plazo, para no ir a SharePoint en cada intento. */
let cacheExcepciones: { cuando: number; correos: Set<string> } | null = null;

/**
 * Los correos autorizados que NO pertenecen a un dominio del grupo.
 *
 * Lo mantiene Talento Humano en el SharePoint, en Excel. Si el archivo no
 * existe o no se puede leer, se devuelve vacío: el portal sigue funcionando
 * con los dominios, que es el camino del 99 % de la gente. Fallar el ingreso
 * de todos porque un archivo de excepciones no está sería el remedio peor que
 * la enfermedad.
 */
export async function leerExcepciones(): Promise<Set<string>> {
  if (cacheExcepciones && Date.now() - cacheExcepciones.cuando < EXCEPCIONES_CACHE_MS) {
    return cacheExcepciones.correos;
  }

  try {
    const data = (await llamarConector('sharepoint_get_download_url', {
      driveName: `site:${SITIO_TH}`,
      path: ARCHIVO_EXCEPCIONES,
      includeContent: true,
    })) as { content_base64?: string } | null;

    if (!data?.content_base64) {
      cacheExcepciones = { cuando: Date.now(), correos: new Set() };
      return cacheExcepciones.correos;
    }

    const binario = Buffer.from(data.content_base64, 'base64');
    const esExcel = ARCHIVO_EXCEPCIONES.toLowerCase().endsWith('.xlsx');
    const correos = esExcel ? await correosDeExcel(binario) : correosDeTexto(binario);

    cacheExcepciones = { cuando: Date.now(), correos: new Set(correos) };
    return cacheExcepciones.correos;
  } catch (error) {
    console.warn('[portal] no se pudo leer la lista de excepciones:', (error as Error).message);
    // NO se cachea el fallo: si fue un tropiezo de red, el siguiente intento
    // vuelve a probar en vez de quedarse una hora con la lista vacía.
    return new Set();
  }
}

/** Descarga un archivo del sitio. Devuelve null si no está. */
export async function descargarArchivo(
  ruta: string
): Promise<{ contenido: Buffer; mime: string } | null> {
  const data = (await llamarConector('sharepoint_get_download_url', {
    driveName: `site:${SITIO_TH}`,
    path: ruta,
    includeContent: true,
  })) as { content_base64?: string; mime_type?: string } | null;

  if (!data?.content_base64) return null;
  return {
    contenido: Buffer.from(data.content_base64, 'base64'),
    mime: data.mime_type || 'application/octet-stream',
  };
}
