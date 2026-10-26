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
 *      (Web Share API nivel 2). Donde no se pueden compartir archivos
 *      (escritorio, navegadores viejos), Descargar + un enlace wa.me que solo
 *      lleva el NOMBRE del archivo. Nunca un enlace público de OneDrive.
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
