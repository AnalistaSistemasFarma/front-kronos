/**
 * Registro de los dashboards con permiso propio (menú «Dashboard» del encabezado).
 *
 * Lista PURA (sin Prisma ni React) para que la usen el servidor (chequeo de acceso)
 * y el cliente (menú). Cada dashboard tiene su subproceso en `subprocess` y se
 * otorga por usuario y empresa en `subprocess_user_company` (Administración →
 * Usuarios). Sin la asignación no aparece ni el menú, ni la página, ni la API.
 *
 * Un dashboard nuevo solo agrega una línea aquí.
 */
export interface DashboardRegistro {
  key: string;
  label: string;
  href: string;
  subprocessUrl: string;
}

export const DASHBOARDS_REGISTRO = [
  {
    key: 'venta-diaria',
    label: 'Venta diaria',
    href: '/process/dashboards/venta-diaria',
    subprocessUrl: '/process/dashboards/venta-diaria',
  },
] as const satisfies readonly DashboardRegistro[];

export type DashboardKey = (typeof DASHBOARDS_REGISTRO)[number]['key'];

/** Claves del registro cuyo subproceso aparece entre las URL otorgadas. */
export function dashboardsPermitidos(urlsOtorgadas: Iterable<string | null | undefined>): DashboardKey[] {
  const urls = new Set(urlsOtorgadas);
  return DASHBOARDS_REGISTRO.filter((d) => urls.has(d.subprocessUrl)).map((d) => d.key);
}
