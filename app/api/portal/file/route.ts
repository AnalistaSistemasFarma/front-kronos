import { NextRequest, NextResponse } from 'next/server';
import { leerSesion } from '../../../../lib/portal/auth';
import {
  CARPETA_BANNERS,
  CARPETA_DOCUMENTOS,
  CARPETA_IMAGENES,
  COOKIE_SESION,
} from '../../../../lib/portal/config';
import { descargarArchivo } from '../../../../lib/portal/sharepoint';

/**
 * Sirve un archivo del portal — un PDF o una imagen.
 *
 *   GET /api/portal/file?ruta=POLITICAS%20Y%20REGLAMENTOS/Reglamento....pdf
 *
 * POR QUÉ NO SE MANDA AL USUARIO A SHAREPOINT: los enlaces del sitio exigen
 * sesión de Microsoft —que es justo lo que estas personas no tienen— y los
 * enlaces de descarga de Graph caducan a la hora. El portal sirve el archivo
 * por su propio camino y así funciona para todos.
 *
 * ⚠️ LA RUTA LLEGA DEL NAVEGADOR, así que se valida contra las TRES carpetas
 * conocidas. Sin esa reja, un `ruta=../../otra cosa` convertiría este endpoint
 * en un lector de todo el SharePoint de GSS para cualquiera con una sesión del
 * portal.
 */
const CARPETAS_PERMITIDAS = [CARPETA_DOCUMENTOS, CARPETA_IMAGENES, CARPETA_BANNERS];

function rutaSegura(ruta: string): boolean {
  if (!ruta || ruta.includes('..') || ruta.includes('\\') || ruta.startsWith('/')) return false;
  const barra = ruta.indexOf('/');
  if (barra < 0) return false;
  const carpeta = ruta.slice(0, barra);
  const archivo = ruta.slice(barra + 1);
  // Un solo nivel: carpeta conocida y un nombre de archivo, nada más.
  return CARPETAS_PERMITIDAS.includes(carpeta) && archivo.length > 0 && !archivo.includes('/');
}

export async function GET(request: NextRequest) {
  const correo = leerSesion(request.cookies.get(COOKIE_SESION)?.value);
  if (!correo) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });

  const ruta = request.nextUrl.searchParams.get('ruta') ?? '';
  if (!rutaSegura(ruta)) {
    console.warn(`[portal] ruta rechazada (${correo}): ${ruta}`);
    return NextResponse.json({ error: 'Ruta no permitida.' }, { status: 400 });
  }

  try {
    const archivo = await descargarArchivo(ruta);
    if (!archivo) return NextResponse.json({ error: 'No se encontró el archivo.' }, { status: 404 });

    const nombre = ruta.slice(ruta.indexOf('/') + 1);
    return new NextResponse(new Uint8Array(archivo.contenido), {
      headers: {
        'Content-Type': archivo.mime,
        'Content-Length': String(archivo.contenido.byteLength),
        // `inline` para que el PDF se abra en el visor del navegador en vez de
        // descargarse: la gente entra a consultar, no a coleccionar archivos.
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        // Privada y corta: el contenido lo cambia Talento Humano cuando quiera.
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[portal] GET /api/portal/file', error);
    return NextResponse.json({ error: 'No se pudo abrir el archivo.' }, { status: 502 });
  }
}
