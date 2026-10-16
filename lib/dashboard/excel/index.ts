/*
 * Exportaciones a Excel del dashboard, con CARGA DIFERIDA (2026-10-03).
 *
 * Antes este índice reexportaba las funciones de forma estática y arrastraba
 * `exceljs` (~900 KB sin comprimir, ~250 KB gzip) al paquete de TODAS las
 * páginas del hub: el layout del hub monta AppHubShell → DashboardShell →
 * vistas de analítica → este índice. El chat, que nada exporta a Excel, lo
 * descargaba igual en cada carga en frío del celular.
 *
 * Ahora cada función trae su módulo (y `exceljs`) solo cuando la persona pulsa
 * "Exportar". Mismas firmas, mismo comportamiento; la primera exportación tarda
 * lo que demore bajar ese pedazo una vez.
 *
 * Los `import type` se borran al compilar: no generan dependencia en tiempo de
 * ejecución.
 */
import type { ExportSolicitudesParams } from './exportSolicitudes';
import type { ExportActividadesParams } from './exportActividades';
import type { ExportTicketsParams } from './exportTickets';
import type { ExportProcesosParams } from './exportProcesos';

export async function exportSolicitudesExcel(params: ExportSolicitudesParams): Promise<void> {
  const { exportSolicitudesExcel: exportar } = await import('./exportSolicitudes');
  return exportar(params);
}

export async function exportActividadesExcel(params: ExportActividadesParams): Promise<void> {
  const { exportActividadesExcel: exportar } = await import('./exportActividades');
  return exportar(params);
}

export async function exportTicketsExcel(params: ExportTicketsParams): Promise<void> {
  const { exportTicketsExcel: exportar } = await import('./exportTickets');
  return exportar(params);
}

export async function exportProcesosExcel(params: ExportProcesosParams): Promise<void> {
  const { exportProcesosExcel: exportar } = await import('./exportProcesos');
  return exportar(params);
}
