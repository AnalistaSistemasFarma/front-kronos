import 'server-only';
import { EventEmitter } from 'events';

/** Payload de post en eventos (mismo shape que la API GET). */
export type ValentineRealtimePost = {
  id: number;
  message: string;
  categoryId: string;
  toName: string | null;
  createdAt: string;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
};

export type ValentineRealtimeEvent =
  | {
      type: 'post_created';
      companyId: number;
      post: ValentineRealtimePost;
    }
  | {
      type: 'post_deleted';
      companyId: number;
      postId: number;
    }
  | {
      type: 'reaction_changed';
      companyId: number;
      postId: number;
      emoji: string;
      added: boolean;
      userId: string;
    };

type GlobalBus = typeof globalThis & {
  __valentineWallBus?: EventEmitter;
};

function getBus(): EventEmitter {
  const g = globalThis as GlobalBus;
  if (!g.__valentineWallBus) {
    g.__valentineWallBus = new EventEmitter();
    g.__valentineWallBus.setMaxListeners(500);
  }
  return g.__valentineWallBus;
}

function channelKey(companyId: number) {
  return `valentine-wall:${companyId}`;
}

export function publishValentineEvent(event: ValentineRealtimeEvent): void {
  getBus().emit(channelKey(event.companyId), event);
}

export function subscribeValentineCompany(
  companyId: number,
  listener: (event: ValentineRealtimeEvent) => void
): () => void {
  const key = channelKey(companyId);
  const bus = getBus();
  bus.on(key, listener);
  return () => {
    bus.off(key, listener);
  };
}
