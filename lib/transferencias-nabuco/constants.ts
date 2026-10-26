/**
 * Transferencias Nabuco — constantes del módulo (2026-10-25).
 * Archivo PURO (sin BD ni `server-only`): lo usan la UI, las rutas y las pruebas.
 */

export const NABUCO_MODULE_NAME = 'Transferencias Nabuco';
export const NABUCO_ADMIN_NAME = 'Transferencias Nabuco · Administración';
export const NABUCO_BASE_URL = '/process/transferencias-nabuco';

/** Subprocesos-permiso (subprocess × company_user), sembrados por el SQL del módulo. */
export const NABUCO_SUBPROCESS_URLS = {
  lectura: '/process/transferencias-nabuco',
  admin: '/process/transferencias-nabuco/admin',
} as const;

/** job_types del programador central (lib/scheduler/handlers.js). */
export const NABUCO_JOB_TYPE = 'nabuco_transferir';
export const NABUCO_VIGILANTE_JOB_TYPE = 'nabuco_vigilar';
export const NABUCO_SOURCE_MODULE = 'transferencias-nabuco';

/** Entidades de SAP que pueden disparar el envío. */
export const NABUCO_ENTIDADES = ['Invoices', 'DeliveryNotes', 'Orders', 'StockTransfers', 'InventoryTransferRequests'] as const;
export type NabucoEntidad = (typeof NABUCO_ENTIDADES)[number];

export const ENTIDAD_LABEL: Record<NabucoEntidad, string> = {
  Invoices: 'Facturas de venta (Invoices)',
  DeliveryNotes: 'Entregas (DeliveryNotes)',
  Orders: 'Pedidos de venta (Orders)',
  StockTransfers: 'Transferencias de stock (StockTransfers)',
  InventoryTransferRequests: 'Solicitudes de traslado (InventoryTransferRequests)',
};

/** Colección de líneas según la entidad (las de transferencias usan StockTransferLines). */
export function coleccionLineas(entidad: string): 'DocumentLines' | 'StockTransferLines' {
  return entidad === 'StockTransfers' || entidad === 'InventoryTransferRequests' ? 'StockTransferLines' : 'DocumentLines';
}

export function esEntidadValida(v: unknown): v is NabucoEntidad {
  return typeof v === 'string' && (NABUCO_ENTIDADES as readonly string[]).includes(v);
}

export const NABUCO_ESTADOS = ['pendiente', 'enviado', 'error', 'simulado', 'descartado'] as const;
export type NabucoEstado = (typeof NABUCO_ESTADOS)[number];

export const ESTADO_LABEL: Record<NabucoEstado, string> = {
  pendiente: 'Pendiente',
  enviado: 'Enviado',
  error: 'Error',
  simulado: 'Simulado',
  descartado: 'Descartado',
};

export const ESTADO_COLOR: Record<NabucoEstado, string> = {
  pendiente: 'yellow',
  enviado: 'green',
  error: 'red',
  simulado: 'blue',
  descartado: 'gray',
};

/** Opciones comunes de programación (la UI permite además un cron libre). */
export const CRON_OPCIONES = [
  { value: '*/5 * * * *', label: 'Cada 5 minutos' },
  { value: '*/15 * * * *', label: 'Cada 15 minutos' },
  { value: '*/30 * * * *', label: 'Cada 30 minutos' },
  { value: '0 * * * *', label: 'Cada hora' },
];

export const DEFAULTS = {
  org: '1',
  rutaToken: '/AuthBI',
  rutaSolicitudes: '/api/NabucoWmsSolicitudesAlistamiento',
  timeoutMs: 30000,
  entidad: 'Invoices' as NabucoEntidad,
  loteMax: 50,
  maxReintentos: 3,
  esperaReintentoMin: 30,
  claveLineas: 'items',
  cron: '*/15 * * * *',
};

/** Límites de validación. */
export const LIMITES = {
  timeoutMs: { min: 1000, max: 120000 },
  loteMax: { min: 1, max: 500 },
  maxReintentos: { min: 0, max: 20 },
  esperaReintentoMin: { min: 1, max: 1440 },
  /** Un lock de corrida más viejo que esto se considera abandonado (caída del proceso). */
  lockMinutos: 30,
};

/** Pruebas manuales (pestaña «Pruebas manuales»). */
export const PRUEBAS_MANUALES = {
  /** Host de PRODUCCIÓN de Nabuco: el envío manual exige confirmación explícita. */
  hostProduccion: 'nabucoapi.azurewebsites.net',
  /** Palabra que hay que escribir en el modal para enviar a producción. */
  palabraProduccion: 'PRODUCCION',
  historial: 20,
  maxRespuesta: 100_000,
  maxPayload: 1_000_000,
};

/** true si la URL parece la de producción de Nabuco (regla simple: contiene el host de producción). */
export function esUrlProduccionNabuco(url: string | null | undefined): boolean {
  return String(url ?? '')
    .toLowerCase()
    .includes(PRUEBAS_MANUALES.hostProduccion);
}
