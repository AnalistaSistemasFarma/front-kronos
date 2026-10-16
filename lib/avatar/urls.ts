/**
 * URLs del avatar estilo Notion. Módulo aparte y diminuto A PROPÓSITO: lo usa
 * el chat (lib/chat/client.ts) y no debe arrastrar el catálogo de dibujos a
 * ese paquete del navegador.
 */

/* ───────────────────── URLs de las imágenes servidas ───────────────────── */

/** Prefijo de las URLs que sirve SynerLink con el avatar compuesto. */
export const AVATAR_URL_PREFIX = '/api/avatar/';

export function userAvatarUrl(userId: string, version: number): string {
  return `${AVATAR_URL_PREFIX}user/${encodeURIComponent(userId)}?v=${version}`;
}

export function agentAvatarNotionUrl(code: string, version: number): string {
  return `${AVATAR_URL_PREFIX}agent/${encodeURIComponent(code)}?v=${version}`;
}

/** ¿Esta URL de imagen es un avatar estilo Notion servido por SynerLink? */
export function isNotionAvatarUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(AVATAR_URL_PREFIX);
}

/** Versión (?v=) de una URL de avatar estilo Notion, o null. */
export function notionAvatarVersion(url: string | null | undefined): number | null {
  if (!isNotionAvatarUrl(url)) return null;
  const m = /[?&]v=(\d+)/.exec(url as string);
  return m ? Number(m[1]) : null;
}
