import {
  avatarDataUri,
  composeAvatarSvg,
  parseAvatarConfig,
  serializeAvatarConfig,
  MAX_CONFIG_JSON,
} from './compose';
import { figuraV4ACabeza, parseFiguraConfig } from './figuras';
import type { AvatarConfig } from './types';

/**
 * Avatar de un ASISTENTE del chat: siempre Lorelei (config v3), con boca
 * sonriente y, si se quiere, una CABEZA-FIGURA (animal, planeta,
 * constelación, estrella o robot: cabezas.ts) en lugar de Cabeza 1…4. Las
 * personas (usuarios) no pasan por aquí.
 *
 * Los configs v3 ya guardados siguen valiendo tal cual. Los v4 del #554
 * (figura con carita propia) se CONVIERTEN al leerlos a su cabeza-figura
 * equivalente (figuras.ts); no se borran de la base.
 */

export type AgentAvatarConfig = AvatarConfig;

/**
 * Valida el avatar de un asistente (cuerpo de la petición o la base): v3
 * (boca happy*, cabeza de Lorelei o cabeza-figura) o un v4 heredado, que se
 * devuelve ya convertido a v3. Cualquier otra cosa → null.
 */
export function parseAgentAvatarConfig(raw: unknown): AgentAvatarConfig | null {
  let valor: unknown = raw;
  if (typeof valor === 'string') {
    if (valor.length > MAX_CONFIG_JSON) return null;
    try {
      valor = JSON.parse(valor);
    } catch {
      return null;
    }
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  if ((valor as { v?: unknown }).v === 4) {
    const figura = parseFiguraConfig(valor);
    return figura ? parseAvatarConfig(figuraV4ACabeza(figura), 'agent') : null;
  }
  return parseAvatarConfig(valor, 'agent');
}

export function serializeAgentAvatarConfig(c: AgentAvatarConfig): string {
  return serializeAvatarConfig(c);
}

export function composeAgentAvatarSvg(c: AgentAvatarConfig, opts: { size?: number; title?: string } = {}): string {
  return composeAvatarSvg(c, opts);
}

/** data: URI para <img src> (nunca SVG en línea). */
export function agentAvatarDataUri(c: AgentAvatarConfig): string {
  return avatarDataUri(c);
}
