/**
 * PAQUETES de stickers propios del chat (2026-10-20).
 *
 * Une los paquetes versionados en el repositorio, sin tocar ninguno:
 *   - 'animados': Noto Emoji Animation (WebP animado, CC BY 4.0) — ver
 *     lib/chat/stickers-animados-catalog.ts.
 *   - 'gss': el paquete estático propio del PR #698 (SVG) — ver
 *     lib/chat/stickers-catalog.ts.
 * Los stickers que cargue una empresa (tabla chat_sticker) llegan como un
 * tercer paquete, 'empresa', desde /api/chat/stickers.
 *
 * Los dos paquetes propios se guardan igual en la base (provider 'gss' +
 * external_id = código); el prefijo `noto-` los distingue. Lo usan el servidor
 * (validar al enviar y serializar al leer) y el navegador.
 */

import { stickerGss, urlStickerGss, STICKERS_GSS } from './stickers-catalog';
import {
  stickerAnimado,
  urlPosterStickerAnimado,
  urlStickerAnimado,
  STICKERS_ANIMADOS,
} from './stickers-animados-catalog';

export type IdPaquete = 'animados' | 'gss' | 'empresa';

export interface PaqueteStickers {
  id: IdPaquete;
  nombre: string;
}

/** Orden de la barra de paquetes: primero los animados, como en Telegram. */
export const PAQUETES_PROPIOS: readonly PaqueteStickers[] = [
  { id: 'animados', nombre: 'Animados' },
  { id: 'gss', nombre: 'GSS' },
];

export const PAQUETE_EMPRESA: PaqueteStickers = { id: 'empresa', nombre: 'De la empresa' };

export interface StickerPropioResuelto {
  code: string;
  label: string;
  keywords: string;
  paquete: 'animados' | 'gss';
  /** Imagen a mostrar en movimiento (o la única, si es estático). */
  src: string;
  /** Cuadro fijo; solo en los animados. */
  poster: string | null;
  animated: boolean;
}

/** Un sticker propio (de cualquiera de los dos paquetes) por su código, o null. */
export function stickerPropio(code: unknown): StickerPropioResuelto | null {
  const a = stickerAnimado(code);
  if (a) {
    return {
      code: a.code,
      label: a.label,
      keywords: a.keywords,
      paquete: 'animados',
      src: urlStickerAnimado(a.code),
      poster: urlPosterStickerAnimado(a.code),
      animated: true,
    };
  }
  const g = stickerGss(code);
  if (g) {
    return {
      code: g.code,
      label: g.label,
      keywords: g.keywords,
      paquete: 'gss',
      src: urlStickerGss(g.code),
      poster: null,
      animated: false,
    };
  }
  return null;
}

/** Todos los stickers propios, en el orden de los paquetes. */
export function todosLosStickersPropios(): StickerPropioResuelto[] {
  return [...STICKERS_ANIMADOS.map((x) => x.code), ...STICKERS_GSS.map((x) => x.code)]
    .map((c) => stickerPropio(c))
    .filter((x): x is StickerPropioResuelto => x !== null);
}
