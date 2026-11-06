import { resolveSessionUser, serverError } from '../../../../lib/chat/http';
import { collectChatAttachments } from '../../../../lib/chat/attachments';
import {
  normalizarTextoCompartido,
  SHARE_PAGE_PATH,
  type TextoCompartido,
} from '../../../../lib/chat/compartir-share-target';

export const dynamic = 'force-dynamic';

/**
 * DESTINO DEL MENÚ «COMPARTIR» DE ANDROID (share_target del manifiesto).
 *
 *   POST /api/chat/compartir   multipart/form-data   title, text, url, files…
 *
 * ⚠️ El camino NORMAL no llega aquí: el service worker (public/sw.js)
 * intercepta este POST en el celular, guarda los archivos en IndexedDB y abre
 * la pantalla «Compartir en SynerLink» sin subir nada hasta que la persona
 * confirma. Esta ruta es el RESPALDO para cuando el service worker todavía no
 * controla la página (recién instalado, datos del sitio borrados).
 *
 * El servidor NO guarda archivos aquí (no hay conversación elegida todavía y
 * dejar binarios huérfanos en disco es peor que pedir que se repita): exige
 * sesión, valida con LAS MISMAS reglas del chat y redirige a la pantalla con
 * el texto y el enlace, y un aviso para volver a compartir los archivos.
 *
 * Siempre responde 303 (es una navegación del sistema, no una llamada de
 * API) con `Location` RELATIVO: detrás de IIS/ARR `request.url` trae el host
 * interno y un absoluto mandaría al celular a una dirección que no conoce.
 */
function redirigir(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store, max-age=0' },
  });
}

function urlPantalla(texto: TextoCompartido | null, extra: Record<string, string>): string {
  const sp = new URLSearchParams();
  if (texto?.title) sp.set('title', texto.title);
  if (texto?.text) sp.set('text', texto.text);
  if (texto?.url) sp.set('url', texto.url);
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${SHARE_PAGE_PATH}?${qs}` : SHARE_PAGE_PATH;
}

export async function POST(request: Request) {
  try {
    // SESIÓN PRIMERO: sin ella no se lee el cuerpo (nadie sin sesión obliga
    // al servidor a parsear un multipart grande). Al login, y de vuelta a la
    // pantalla; lo compartido hay que repetirlo.
    const user = await resolveSessionUser();
    if (!user) {
      return redirigir(`/login?callbackUrl=${encodeURIComponent(urlPantalla(null, { aviso: 'sin-sw' }))}`);
    }

    let form: FormData | null = null;
    if ((request.headers.get('content-type') ?? '').toLowerCase().includes('multipart/form-data')) {
      try {
        form = await request.formData();
      } catch {
        form = null;
      }
    }

    const texto = form
      ? normalizarTextoCompartido({ title: form.get('title'), text: form.get('text'), url: form.get('url') })
      : null;

    // Android manda a veces una entrada `files` vacía cuando solo se comparte
    // texto: esa no cuenta como archivo.
    const sinVacios = new FormData();
    for (const entrada of form?.getAll('files') ?? []) {
      if (entrada instanceof File && (entrada.size > 0 || entrada.name)) sinVacios.append('files', entrada);
    }

    if (!form) return redirigir(urlPantalla(null, { aviso: 'recepcion' }));

    const archivos = collectChatAttachments(sinVacios);
    if (!archivos.ok) return redirigir(urlPantalla(texto, { error: archivos.error }));

    // Llegaron archivos válidos, pero el service worker no los guardó en el
    // celular: hay que pedir que se repita.
    if (archivos.files.length > 0) return redirigir(urlPantalla(texto, { aviso: 'sin-sw' }));

    return redirigir(urlPantalla(texto, {}));
  } catch (error) {
    return serverError('POST /api/chat/compartir', error);
  }
}
