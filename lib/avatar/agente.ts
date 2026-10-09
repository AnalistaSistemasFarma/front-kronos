import {
  avatarDataUri,
  composeAvatarSvg,
  parseAvatarConfig,
  serializeAvatarConfig,
  sugerenciaParaAgente,
  svgToDataUri,
  MAX_CONFIG_JSON,
} from './compose';
import {
  ETIQUETA_KIND,
  FIGURA_KINDS,
  composeFiguraSvg,
  figuraPorDefecto,
  parseFiguraConfig,
  serializeFiguraConfig,
  type FiguraConfig,
  type FiguraKind,
} from './figuras';
import type { AvatarConfig } from './types';

/**
 * Avatar de un ASISTENTE del chat: o una persona Lorelei (configuración v3,
 * la de siempre) o una FIGURA (v4: animal, planeta, constelación, estrella o
 * robot). Las personas (usuarios) no pasan por aquí: siguen solo con Lorelei.
 *
 * Los configs v3 ya guardados siguen valiendo tal cual (tipo 'persona').
 */

export type AgentAvatarKind = 'persona' | FiguraKind;
export type AgentAvatarConfig = AvatarConfig | FiguraConfig;

/** Tipos del selector del editor de asistentes, en orden. */
export const AGENT_AVATAR_KINDS: readonly AgentAvatarKind[] = ['persona', ...FIGURA_KINDS];

export const ETIQUETA_AGENT_KIND: Readonly<Record<AgentAvatarKind, string>> = { persona: 'Persona', ...ETIQUETA_KIND };

export const esFigura = (c: AgentAvatarConfig): c is FiguraConfig => c.v === 4;

export function kindDe(c: AgentAvatarConfig): AgentAvatarKind {
  return esFigura(c) ? c.kind : 'persona';
}

/**
 * Valida el avatar de un asistente (cuerpo de la petición o la base): v3
 * persona (con boca happy*) o v4 figura. Cualquier otra cosa → null.
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
  if ((valor as { v?: unknown }).v === 4) return parseFiguraConfig(valor);
  return parseAvatarConfig(valor, 'agent');
}

export function serializeAgentAvatarConfig(c: AgentAvatarConfig): string {
  return esFigura(c) ? serializeFiguraConfig(c) : serializeAvatarConfig(c);
}

export function composeAgentAvatarSvg(c: AgentAvatarConfig, opts: { size?: number; title?: string } = {}): string {
  return esFigura(c) ? composeFiguraSvg(c, opts) : composeAvatarSvg(c, opts);
}

/** data: URI para <img src> (nunca SVG en línea). */
export function agentAvatarDataUri(c: AgentAvatarConfig): string {
  return esFigura(c) ? svgToDataUri(composeFiguraSvg(c)) : avatarDataUri(c);
}

/**
 * Avatar por defecto de un asistente para un tipo, determinista por su
 * nombre: persona Lorelei con la semilla del nombre, o la figura del tipo.
 */
export function agentAvatarPorDefecto(kind: AgentAvatarKind, nombre: string): AgentAvatarConfig {
  return kind === 'persona' ? sugerenciaParaAgente(nombre) : figuraPorDefecto(kind, nombre);
}
