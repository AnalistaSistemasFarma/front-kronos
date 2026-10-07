export const ORION_INITIAL_VERSION_LABEL = 'v1.0';

export type OrionVersionParts = { major: number; minor: number };

export function parseOrionVersionLabel(label: string | null | undefined): OrionVersionParts {
  // eslint-disable-next-line security/detect-unsafe-regex -- falso positivo: patrón anclado y lineal (`v1.0`); la entrada es una etiqueta de versión corta.
  const match = /^v?(\d+)(?:\.(\d+))?$/i.exec(String(label || '').trim());
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
