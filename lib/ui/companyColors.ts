/**
 * Color de cada compañía para distinguirla en las tablas (fondo sutil, preferencia del usuario).
 * Colores de Mantine para que funcionen en modo claro y oscuro (variable `--mantine-color-X-light`).
 */
const COLORS: { match: RegExp; color: string }[] = [
  { match: /onelatamonco|olp\s*onco/i, color: 'pink' },
  { match: /onelatam|one latam|\bolp\b/i, color: 'grape' },
  { match: /farmal[oó]gica/i, color: 'blue' },
  { match: /ryan/i, color: 'red' },
  { match: /meditrack/i, color: 'yellow' },
  { match: /abamia/i, color: 'indigo' },
  { match: /kelab/i, color: 'teal' },
  { match: /unidossis/i, color: 'orange' },
  { match: /^\s*gss\b|group shared services/i, color: 'cyan' },
];

export function companyColor(name?: string | null): string | null {
  const n = String(name ?? '');
  return COLORS.find((c) => c.match.test(n))?.color ?? null;
}

/** Estilo de fila con el fondo sutil de la compañía (o nada si no aplica). */
export function companyRowStyle(name: string | null | undefined, enabled: boolean): { background?: string } {
  if (!enabled) return {};
  const c = companyColor(name);
  return c ? { background: `var(--mantine-color-${c}-light)` } : {};
}
