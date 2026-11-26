/**
 * Pure rules of the agent-initiated messages (2026-11-24). No database: see lib/chat/agent-initiated.ts.
 */

/** Badge shown on an agent message that the agent sent on its own (not as a reply). */
export const AGENT_INITIATED_BADGE = 'Mensaje iniciado por el asistente';

/** Longest excerpt of each agent-initiated message handed to the agent as context. */
export const CONTEXT_ITEM_MAX_CHARS = 1500;

export interface InitiatedContextItem {
  body: string;
  createdAt: Date;
  reason: string | null;
}

function bogotaTime(d: Date): string {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function quote(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  const cut = clean.length > CONTEXT_ITEM_MAX_CHARS ? `${clean.slice(0, CONTEXT_ITEM_MAX_CHARS - 1)}…` : clean;
  return cut
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
}

/**
 * Text prepended to the person's reply so the agent session that serves the conversation knows what
 * it had written on its own. Spanish: the agents work in Spanish. Empty string when there is nothing.
 */
export function buildInitiatedContextPrefix(items: InitiatedContextItem[]): string {
  if (items.length === 0) return '';
  const lines: string[] = [
    '[Contexto de SynerLink: antes de este mensaje, usted (el asistente) le escribió a esta persona por iniciativa propia en esta conversación. Su respuesta puede referirse a eso.]',
  ];
  for (const item of items) {
    const reason = item.reason?.replace(/\s+/g, ' ').trim();
    lines.push(`Mensaje suyo del ${bogotaTime(item.createdAt)}${reason ? ` (motivo registrado: ${reason})` : ''}:`);
    lines.push(quote(item.body));
  }
  lines.push('[Respuesta de la persona:]');
  return `${lines.join('\n')}\n`;
}
