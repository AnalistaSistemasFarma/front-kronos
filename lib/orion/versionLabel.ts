export const ORION_INITIAL_VERSION_LABEL = 'v1.0';

export type OrionVersionParts = { major: number; minor: number };

export function parseOrionVersionLabel(label: string | null | undefined): OrionVersionParts {
  // "v1.2" o "v1" (dos expresiones simples en vez de un grupo opcional anidado).
  const value = String(label || '').trim();
  const match = /^v?(\d+)\.(\d+)$/i.exec(value) ?? /^v?(\d+)$/i.exec(value);
  if (!match) return { major: 1, minor: 0 };
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return {
    major: Number.isInteger(major) && major > 0 ? major : 1,
    minor: Number.isInteger(minor) && minor >= 0 ? minor : 0,
  };
}

export function formatOrionVersionLabel(parts: OrionVersionParts): string {
  return `v${parts.major}.${parts.minor}`;
}

export function resolveOrionVersionLabel(label: string | null | undefined): string {
  return formatOrionVersionLabel(parseOrionVersionLabel(label));
}

/** Subversión siguiente: v1.0 → v1.1 → v1.2 … */
export function nextOrionSubversionLabel(label: string | null | undefined): string {
  const { major, minor } = parseOrionVersionLabel(label);
  return formatOrionVersionLabel({ major, minor: minor + 1 });
}
