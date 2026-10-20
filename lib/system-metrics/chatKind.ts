/**
 * ¿Una conversación del chat es entre personas o con agentes?
 *
 * Los dos chats usan las mismas rutas para un hilo (/api/chat/conversations/:id/…) y para los
 * adjuntos, así que el monitor no puede separarlos solo con la URL. Este caché consulta UNA vez
 * el tipo de cada conversación (`chat_conversation.kind`) y lo recuerda: el tipo no cambia nunca.
 * Sin dependencias de SQL (la consulta se inyecta) para poder probarlo.
 */

import type { ChatLookupTarget } from './routeKey';

export type ChatKind = 'people' | 'ai';

/** Tope de entradas recordadas; al llenarse se vacía (lo normal son unos cientos de hilos). */
const MAX_ENTRIES = 5000;

/** 'people' = hilo entre dos personas; 'direct' | 'group' | 'project' = con agentes. */
export function chatKindOf(kind: string | null | undefined): ChatKind | null {
  if (!kind) return null;
  return kind === 'people' ? 'people' : 'ai';
}

/** Si la consulta falla (p. ej. la base no tiene las tablas del chat), no se reintenta en este tiempo. */
const PAUSE_ON_ERROR_MS = 10 * 60_000;

export class ChatKindCache {
  private known = new Map<string, ChatKind>();
  private pending = new Map<string, Promise<ChatKind | null>>();
  private pausedUntil = 0;

  constructor(
    private readonly lookup: (target: ChatLookupTarget) => Promise<string | null>,
    private readonly now: () => number = Date.now
  ) {}

  private keyOf(target: ChatLookupTarget): string {
    return `${target.table}:${target.id}`;
  }

  /** Tipo ya conocido, o `undefined` si todavía no se consultó. */
  peek(target: ChatLookupTarget): ChatKind | undefined {
    return this.known.get(this.keyOf(target));
  }

  /** Consulta el tipo (una sola vez por conversación aunque lleguen varias peticiones juntas). */
  resolve(target: ChatLookupTarget): Promise<ChatKind | null> {
    const key = this.keyOf(target);
    const known = this.known.get(key);
    if (known) return Promise.resolve(known);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    // Tras un error se deja de consultar un rato: si no, cada mensaje del chat haría una
    // consulta fallida a la base.
    if (this.now() < this.pausedUntil) return Promise.resolve(null);
    const promise = this.lookup(target)
      .then((raw) => {
        const kind = chatKindOf(raw);
        if (kind) {
          if (this.known.size >= MAX_ENTRIES) this.known.clear();
          this.known.set(key, kind);
        }
        return kind;
      })
      // Si la consulta falla, la petición se cuenta como "Chat" y se reintenta pasada la pausa.
      .catch(() => {
        this.pausedUntil = this.now() + PAUSE_ON_ERROR_MS;
        return null;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
