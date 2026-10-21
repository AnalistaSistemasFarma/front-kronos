/**
 * Reglas PURAS de reacciones, GIF y stickers del chat (2026-10-20).
 *
 * Sin prisma ni nada de servidor: las usan las rutas, el sondeo y también el
 * navegador (los tipos viajan por la red). Ver lib/chat/message-extras.ts para
 * la parte que toca la base.
 */

/** Una reacción agregada, tal como se pinta debajo del mensaje. */
export interface ChatReactionDto {
  emoji: string;
  count: number;
  /** ¿Quien mira puso esta reacción? (el chip se resalta y tocarlo la quita). */
  mine: boolean;
  /** Quiénes reaccionaron, en orden de llegada (máximo MAX_NOMBRES_REACCION). */
  users: { id: string; name: string }[];
}

/**
 * GIF o sticker de un mensaje, tal como lo ve el CLIENTE. `src` es SIEMPRE una
 * ruta de la propia aplicación: el sticker propio (/chat/stickers/…), el de la
 * empresa (/api/chat/stickers/<id>) o el GIF por el proxy firmado
 * (/api/chat/gifs/proxy?…). La URL del proveedor nunca sale del servidor.
 */
export interface ChatMediaDto {
  kind: 'gif' | 'sticker';
  provider: 'giphy' | 'gss' | 'empresa';
  title: string;
  src: string;
  width: number | null;
  height: number | null;
}

/** Cuántos nombres viajan por reacción. Con más, la interfaz dice «y N más». */
export const MAX_NOMBRES_REACCION = 25;

/** Fila de reacción ACTIVA con el nombre de quien reaccionó ya resuelto. */
export interface FilaReaccion {
  id: number;
  id_message: number;
  id_user: string;
  emoji: string;
  nombre: string;
}

/**
 * Agrupa las reacciones activas por mensaje y por emoji. Los emojis salen en
 * el orden en que se pusieron por primera vez (como Slack y WhatsApp): un chip
 * no salta de lugar porque alguien más reaccione con otro emoji.
 */
export function resumirReacciones(filas: FilaReaccion[], yo: string): Map<number, ChatReactionDto[]> {
  const ordenadas = [...filas].sort((a, b) => a.id - b.id);
  const porMensaje = new Map<number, Map<string, ChatReactionDto>>();
  for (const f of ordenadas) {
    let delMensaje = porMensaje.get(f.id_message);
    if (!delMensaje) {
      delMensaje = new Map();
      porMensaje.set(f.id_message, delMensaje);
    }
    let r = delMensaje.get(f.emoji);
    if (!r) {
      r = { emoji: f.emoji, count: 0, mine: false, users: [] };
      delMensaje.set(f.emoji, r);
    }
    r.count += 1;
    if (f.id_user === yo) r.mine = true;
    if (r.users.length < MAX_NOMBRES_REACCION) r.users.push({ id: f.id_user, name: f.nombre });
  }
  const salida = new Map<number, ChatReactionDto[]>();
  for (const [id, m] of porMensaje) salida.set(id, [...m.values()]);
  return salida;
}

/**
 * Aplica, en el navegador, el cambio optimista de MI reacción: si ya la tenía
 * la quita, si no la pone. Devuelve una lista NUEVA (para React).
 */
export function alternarReaccion(
  actuales: ChatReactionDto[] | undefined,
  emoji: string,
  yo: { id: string; name: string }
): ChatReactionDto[] {
  const lista = actuales ?? [];
  const existente = lista.find((r) => r.emoji === emoji);
  if (existente?.mine) {
    return lista
      .map((r) =>
        r.emoji === emoji
          ? { ...r, count: r.count - 1, mine: false, users: r.users.filter((u) => u.id !== yo.id) }
          : r
      )
      .filter((r) => r.count > 0);
  }
  if (existente) {
    return lista.map((r) =>
      r.emoji === emoji ? { ...r, count: r.count + 1, mine: true, users: [...r.users, yo] } : r
    );
  }
  return [...lista, { emoji, count: 1, mine: true, users: [yo] }];
}

/** «Ana», «Ana y Luis», «Ana, Luis y 3 más». Para el globo del chip. */
export function describirQuienes(r: ChatReactionDto): string {
  const nombres = r.users.map((u) => u.name);
  const resto = Math.max(0, r.count - nombres.length);
  if (nombres.length === 0) return `${r.count}`;
  if (resto > 0) return `${nombres.join(', ')} y ${resto} más`;
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/**
 * Título de un GIF, listo para el texto descriptivo del mensaje. GIPHY trae
 * títulos como «Happy Dance GIF by Disney»: se quita el «GIF by …», los
 * caracteres que el Markdown interpretaría y los corchetes (que cerrarían el
 * «[GIF: …]»), y se recorta.
 */
export function limpiarTituloGif(crudo: unknown): string {
  let t = typeof crudo === 'string' ? crudo : '';
  // «… GIF» o «… GIF by Fulano»: se corta desde ese « GIF».
  const corte = t.search(/\sGIF(?:\s|$)/i);
  if (corte > 0) t = t.slice(0, corte);
  t = t.replace(/[[\]*_`<>#|\\~]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > 100) t = `${t.slice(0, 99).trimEnd()}…`;
  return t || 'GIF animado';
}

/**
 * EL TEXTO que queda en `chat_message.body` de un GIF o un sticker. Es lo que
 * leen los agentes, los conectores, la bandeja y el buscador: «[GIF: …]» o
 * «[Sticker: …]». Nunca lleva la URL del proveedor.
 */
export function cuerpoDescriptivo(kind: 'gif' | 'sticker', titulo: string): string {
  const t = titulo.replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim() || (kind === 'gif' ? 'GIF animado' : 'sticker');
  return kind === 'gif' ? `[GIF: ${t}]` : `[Sticker: ${t}]`;
}
