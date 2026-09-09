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
import {
  ARCHIVO_EXCEPCIONES,
  CARPETA_BANNERS,
  CARPETA_DOCUMENTOS,
  CARPETA_IMAGENES,
  CONECTOR_SHAREPOINT_GSS,
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

/**
 * Los correos autorizados que no pertenecen a un dominio del grupo.
 *
 * Lo mantiene Talento Humano en el SharePoint. Si el archivo no existe, no hay
 * excepciones y punto — el portal sigue funcionando con los dominios.
 */
export async function leerExcepciones(): Promise<Set<string>> {
  try {
    const data = (await llamarConector('sharepoint_get_download_url', {
      driveName: `site:${SITIO_TH}`,
      path: ARCHIVO_EXCEPCIONES,
      includeContent: true,
    })) as { content_base64?: string } | null;

    if (!data?.content_base64) return new Set();

    const texto = Buffer.from(data.content_base64, 'base64').toString('utf8');
    const correos = texto
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#') && l.includes('@'));
    return new Set(correos);
  } catch (error) {
    console.warn('[portal] no se pudo leer la lista de excepciones:', (error as Error).message);
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
