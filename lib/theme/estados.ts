/**
 * Colores de ESTADO del tema de SynerLink (éxito, error, advertencia).
 *
 * El color principal cambia con la paleta de cada persona (`primaryColor` de
 * Mantine); los de estado no, porque comunican un significado (aprobó / no
 * aprobó, guardado / error). Esta es la única fuente: se registra en el tema
 * (`theme.other.estados`) y los componentes la usan como `color`/`c` de
 * Mantine o con `varColorEstado()` donde se necesita una variable CSS (íconos).
 * Lo informativo/neutro usa el color principal: `Alert` sin `color` o
 * `var(--mantine-primary-color-filled)`.
 */
export const COLOR_ESTADO = {
  exito: 'green',
  error: 'red',
  advertencia: 'yellow',
} as const;

export type EstadoTema = keyof typeof COLOR_ESTADO;

/** Variable CSS de Mantine (color "filled", se adapta a claro/oscuro) del estado. */
export function varColorEstado(estado: EstadoTema): string {
  return `var(--mantine-color-${COLOR_ESTADO[estado]}-filled)`;
}
