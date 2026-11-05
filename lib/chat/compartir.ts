/**
 * COMPARTIR UN ADJUNTO DEL CHAT — reglas puras (2026-10-24).
 *
 * Pedido de Nicolás Rivera (2026-10-24, 15:18 COT): «quiero que podamos enviar
 * por chat interno de SynerLink los adjuntos o por WhatsApp». En el visor de
 * adjuntos, «Compartir» ofrece:
 *
 *   a) Reenviar por el chat de SynerLink a una persona, un grupo o una
 *      conversación de proyecto donde la persona puede escribir
 *      (POST /api/chat/attachments/<id>/reenviar, que repite las dos puertas).
 *   b) WhatsApp u otras apps: la hoja nativa del celular con el ARCHIVO
 *      (Web Share API nivel 2). En el escritorio (desde 2026-10-27) y donde
 *      no se pueden compartir archivos, Descargar + WhatsApp (Web en el
 *      escritorio, wa.me en el celular) con solo el NOMBRE del archivo.
 *      Nunca un enlace público de OneDrive.
 *
 * Isomórfico: lo usan la ruta y el navegador.
 */
import { tipoMimeDeAdjunto } from './attachments';

export type TipoDestino = 'persona' | 'grupo' | 'proyecto';

/** Un destino posible del reenvío, ya con el texto que se muestra. */
export interface DestinoReenvio {
  idConversation: number;
  tipo: TipoDestino;
  titulo: string;
  /** Segunda línea: empresa del grupo, o conversación y agente del proyecto. */
  detalle: string | null;
  lastMessageAt: string | null;
}

export const ETIQUETA_TIPO: Record<TipoDestino, string> = {
  persona: 'Persona',
  grupo: 'Grupo',
  proyecto: 'Proyecto',
};

/** Tope del comentario que acompaña al reenvío (el mismo mensaje del chat lo vuelve a validar). */
export const MAX_NOTA_REENVIO = 1000;

/** Minúsculas y sin tildes, para buscar «gomez» y encontrar «Gómez». */
export function normalizarBusqueda(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Filtra por tipo y por texto (título o detalle). Conserva el orden de llegada. */
export function filtrarDestinos(destinos: DestinoReenvio[], busqueda: string, tipo: TipoDestino | 'todos' = 'todos'): DestinoReenvio[] {
  const q = normalizarBusqueda(busqueda);
  return destinos.filter((d) => {
    if (tipo !== 'todos' && d.tipo !== tipo) return false;
    if (!q) return true;
    return normalizarBusqueda(`${d.titulo} ${d.detalle ?? ''}`).includes(q);
  });
}

/** Más reciente primero; sin actividad al final. Estable entre iguales. */
export function ordenarDestinos(destinos: DestinoReenvio[]): DestinoReenvio[] {
  return destinos
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const ta = a.d.lastMessageAt ? Date.parse(a.d.lastMessageAt) : 0;
      const tb = b.d.lastMessageAt ? Date.parse(b.d.lastMessageAt) : 0;
      return tb - ta || a.i - b.i;
    })
    .map(({ d }) => d);
}

/**
 * Enlace de WhatsApp para el ESCRITORIO: solo el texto con el nombre del
 * archivo (el archivo se adjunta a mano después de descargarlo). A propósito
 * no lleva ninguna URL: el archivo vive tras la sesión de SynerLink y un
 * enlace público de OneDrive lo dejaría abierto a cualquiera.
 */
export function enlaceWhatsApp(fileName: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`Le comparto el archivo «${fileName}».`)}`;
}

/**
 * Enlace de WhatsApp WEB para el escritorio (2026-10-27): abre
 * web.whatsapp.com con el mismo texto, sin pasar por la página intermedia de
 * wa.me. Igual que `enlaceWhatsApp`, no lleva ninguna URL del archivo.
 */
export function enlaceWhatsAppWeb(fileName: string): string {
  return `https://web.whatsapp.com/send?text=${encodeURIComponent(`Le comparto el archivo «${fileName}».`)}`;
}

/* ─────────────── Estrategia de «WhatsApp u otra app» (2026-10-27) ───────────────
 *
 * Bug reportado por Nicolás Rivera (2026-10-27) en Windows: Chrome y Edge
 * responden `canShare({ files })` = true, el código abría la hoja nativa de
 * Windows y esta salía vacía con «Vuelve a intentarlo. No fue posible
 * enseñarte todas las maneras de las que podrías compartir». La hoja de
 * Windows falla con muchos tipos y tamaños, y el error no siempre llega a la
 * página (la promesa no rechaza), así que el respaldo nunca aparecía.
 *
 * Regla: en el ESCRITORIO nunca se usa `navigator.share` con archivos; se
 * ofrece Descargar + WhatsApp Web. En el CELULAR se mantiene la hoja nativa
 * y, si falla por algo distinto a la cancelación, se cae al respaldo.
 */

/** Lo que se sabe del dispositivo, leído del navegador (puro para poder probarlo). */
export interface EntornoDispositivo {
  userAgent: string;
  /** `navigator.userAgentData?.mobile` (Chrome/Edge); undefined en Safari/Firefox. */
  uaDataMobile?: boolean;
  /** `navigator.userAgentData?.platform`, p. ej. «Windows», «macOS», «Android». */
  uaDataPlatform?: string;
  /** `matchMedia('(pointer: coarse)').matches`: el puntero principal es el dedo. */
  punteroGrueso: boolean;
  /** `navigator.maxTouchPoints` (el iPad se presenta como «Macintosh»). */
  maxTouchPoints: number;
}

const UA_MOVIL = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i;
const UA_WINDOWS = /Windows NT/i;

/**
 * ¿Es un computador de escritorio/portátil (Windows, macOS, Linux)?
 *
 * - Un UA de celular o tableta, o `userAgentData.mobile === true`: no.
 * - Windows siempre es escritorio, aunque tenga pantalla táctil: la hoja de
 *   compartir de Windows es justamente la que falla.
 * - Un «Macintosh» con pantalla táctil es un iPad con iPadOS: no.
 * - Por lo demás, escritorio si el puntero principal no es el dedo.
 */
export function esEscritorio(e: EntornoDispositivo): boolean {
  if (e.uaDataMobile === true) return false;
  if (UA_MOVIL.test(e.userAgent) || /^(Android|iOS)$/i.test(e.uaDataPlatform ?? '')) return false;
  if (UA_WINDOWS.test(e.userAgent) || /^Windows$/i.test(e.uaDataPlatform ?? '')) return true;
  if (/Macintosh/i.test(e.userAgent) && e.maxTouchPoints > 1) return false;
  return !e.punteroGrueso;
}

/** Lee el entorno real del navegador. En el servidor (sin `navigator`) devuelve null. */
export function leerEntornoDispositivo(): EntornoDispositivo | null {
  if (typeof navigator === 'undefined') return null;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean; platform?: string } }).userAgentData;
  let punteroGrueso = false;
  try {
    punteroGrueso = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    punteroGrueso = false;
  }
  return {
    userAgent: navigator.userAgent ?? '',
    uaDataMobile: typeof uaData?.mobile === 'boolean' ? uaData.mobile : undefined,
    uaDataPlatform: typeof uaData?.platform === 'string' ? uaData.platform : undefined,
    punteroGrueso,
    maxTouchPoints: typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0,
  };
}

export type EstrategiaCompartir = 'hoja-nativa' | 'descargar-whatsapp';

/**
 * Qué hace el toque en «WhatsApp u otra app»: la hoja nativa solo en el
 * celular y solo si el archivo ya está listo y el navegador lo acepta.
 */
export function elegirEstrategiaCompartir({ escritorio, puedeArchivo }: { escritorio: boolean; puedeArchivo: boolean }): EstrategiaCompartir {
  return !escritorio && puedeArchivo ? 'hoja-nativa' : 'descargar-whatsapp';
}

/**
 * Qué hacer cuando `navigator.share` rechaza: si la persona cerró la hoja
 * sin elegir app (`AbortError`), nada; cualquier otro error (la hoja no
 * abrió, el tipo no se admite, el gesto expiró…) cae a Descargar + WhatsApp.
 */
export function accionTrasErrorCompartir(error: unknown): 'nada' | 'respaldo' {
  const nombre = error && typeof error === 'object' && 'name' in error ? (error as { name?: unknown }).name : undefined;
  return nombre === 'AbortError' ? 'nada' : 'respaldo';
}

/** Aviso que se muestra arriba del respaldo cuando la hoja del celular falló. */
export const AVISO_HOJA_FALLO = 'No fue posible abrir la hoja para compartir de este dispositivo. Descargue el archivo y adjúntelo en WhatsApp.';

/** Tipo con que se arma el `File` de la hoja de compartir (WhatsApp exige uno real). */
export function tipoParaCompartir(contentType: string | null | undefined, fileName: string): string {
  return tipoMimeDeAdjunto(contentType, fileName) ?? 'application/octet-stream';
}

/** ¿Este navegador puede compartir ESTE archivo con la hoja nativa? */
export function puedeCompartirArchivo(nav: Pick<Navigator, 'canShare' | 'share'> | undefined, archivo: File): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [archivo] });
  } catch {
    return false;
  }
}

/** Mensaje de confirmación del reenvío. */
export function mensajeReenviado(fileName: string, destino: Pick<DestinoReenvio, 'titulo' | 'tipo'>): string {
  const a = destino.tipo === 'persona' ? destino.titulo : `${ETIQUETA_TIPO[destino.tipo].toLowerCase()} «${destino.titulo}»`;
  return `Se reenvió «${fileName}» a ${a}.`;
}
