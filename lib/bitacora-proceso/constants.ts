/**
 * Bitácora de Proceso (registro de intervenciones en planta) — constantes del módulo.
 *
 * Archivo PURO (sin BD ni `server-only`): lo usan los componentes cliente, las
 * rutas y las pruebas. Plan: proyectos/bitacora-proceso-synerlink.md (vault de horus).
 *
 * Nombre: nació como «Órdenes de Trabajo» (2026-10-13); el mismo día Farmalógica
 * envió la especificación oficial «Bitácora de Proceso Plantas Farmalógica» y
 * Nicolás pidió el cambio. Las tablas internas conservan el prefijo `ot_` (y los
 * tipos `Ot*`) para no mover el esquema: es solo un nombre interno.
 */

/** Raíz de las páginas del módulo. */
export const OT_BASE_URL = '/process/bitacora-proceso';

/** Nombre del proceso contenedor (grupo del menú) sembrado en `process`. */
export const OT_PROCESS_NAME = 'Producción';

/**
 * Subprocesos-permiso del módulo. `operario` es la entrada visible del menú;
 * `gestion` es un marcador de permiso (supervisor) que no se lista en el hub.
 */
export const OT_SUBPROCESS_URLS = {
  operario: '/process/bitacora-proceso',
  gestion: '/process/bitacora-proceso/gestion',
} as const;

export type OtPermission = keyof typeof OT_SUBPROCESS_URLS;

/** Nombres visibles de los subprocesos (los mismos del script de siembra). */
export const OT_SUBPROCESS_NAMES: Record<OtPermission, string> = {
  operario: 'Bitácora de Proceso',
  gestion: 'Bitácora de Proceso: Gestión',
};

export const OT_TURNOS = ['MANANA', 'TARDE', 'NOCHE'] as const;
export type OtTurno = (typeof OT_TURNOS)[number];

/** Horario de cada turno (A9, reunión con Farmalógica del 2026-10-14). */
export const OT_TURNO_HORARIO: Record<OtTurno, string> = {
  MANANA: '06–14',
  TARDE: '14–22',
  NOCHE: '22–06',
};

/** Nombre del turno, sin horario. */
export const OT_TURNO_NOMBRE: Record<OtTurno, string> = { MANANA: 'Mañana', TARDE: 'Tarde', NOCHE: 'Noche' };

/** Etiqueta visible del turno con su horario: «Mañana (06–14)». */
export const OT_TURNO_LABEL: Record<OtTurno, string> = {
  MANANA: `${OT_TURNO_NOMBRE.MANANA} (${OT_TURNO_HORARIO.MANANA})`,
  TARDE: `${OT_TURNO_NOMBRE.TARDE} (${OT_TURNO_HORARIO.TARDE})`,
  NOCHE: `${OT_TURNO_NOMBRE.NOCHE} (${OT_TURNO_HORARIO.NOCHE})`,
};

export const OT_ESTADOS = ['ABIERTA', 'CERRADA'] as const;
export type OtEstado = (typeof OT_ESTADOS)[number];

/** Límites de texto (iguales a las columnas de la base). */
export const OT_LIMITS = {
  producto: 200,
  itemCode: 50,
  lote: 50,
  area: 100,
  observacion: 500,
  observacionCierre: 1000,
  actividadNombre: 120,
  maxOperarios: 50,
  operadorNombre: 120,
  operadorDocumento: 30,
  areaNombre: 100,
} as const;

/** Días de bitácoras cerradas que muestra el listado (P0). */
export const OT_DIAS_CERRADAS = 30;

function normalizeUrl(url: string | null | undefined): string {
  return (url ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

const URL_TO_PERMISSION = new Map<string, OtPermission>(
  (Object.entries(OT_SUBPROCESS_URLS) as [OtPermission, string][]).map(([perm, url]) => [url, perm])
);

/** Permiso del módulo que representa una URL de subproceso, o null. */
export function otPermissionFromUrl(url: string | null | undefined): OtPermission | null {
  return URL_TO_PERMISSION.get(normalizeUrl(url)) ?? null;
}

/** true si el subproceso es el marcador de Gestión: otorga el permiso, pero no es tarjeta del menú. */
export function isOtPermissionMarkerSubprocess(subprocess: { subprocess_url?: string | null }): boolean {
  return otPermissionFromUrl(subprocess.subprocess_url) === 'gestion';
}

/** Texto del distintivo del marcador en Administración → Usuarios. */
export function describeOtPermissionMarker(url: string | null | undefined): string | null {
  return otPermissionFromUrl(url) === 'gestion'
    ? 'Permiso Bitácora de Proceso: supervisor (abrir, cerrar y catálogo)'
    : null;
}

/** Nombre visible del módulo. */
export const OT_MODULE_NAME = 'Bitácora de Proceso';

/** Nombre completo para el encabezado y el informe (Farmalógica lo llama «Plantas Farmalógica»). */
export function otNombreCompleto(companyName: string | null | undefined): string {
  const c = (companyName ?? '').trim();
  if (/farmal[oó]gica/i.test(c)) return 'Bitácora de Proceso – Plantas Farmalógica';
  return c ? `Bitácora de Proceso – ${c}` : 'Bitácora de Proceso';
}

/**
 * Íconos opcionales de las actividades (lista cerrada: la base guarda solo la
 * clave). Dos clases:
 *   - PICTOGRAMAS de la especificación de Farmalógica (imágenes estáticas en
 *     public/bitacora-proceso/; Nicolás, 2026-10-13: «sí, cópialos, son para eso»);
 *   - íconos de Tabler elegidos por afinidad para el resto.
 * Cargar imágenes propias desde la pantalla queda para el P1 (requiere almacenamiento).
 */
export const OT_PICTOGRAMAS = {
  'pictograma-tapon': '/bitacora-proceso/alimentacion-tapon.webp',
  'pictograma-mprima': '/bitacora-proceso/alimentacion-mprima.webp',
  'pictograma-agrafe': '/bitacora-proceso/alimentacion-agrafe.webp',
} as const;

export const OT_ICONOS = {
  'pictograma-tapon': 'Pictograma: alimentación de tapón',
  'pictograma-mprima': 'Pictograma: alimentación de materia prima',
  'pictograma-agrafe': 'Pictograma: alimentación de agrafe',
  tapon: 'Tapón',
  'materia-prima': 'Materia prima',
  agrafe: 'Agrafe',
  control: 'Control en proceso',
  autoclave: 'Autoclave',
  uv: 'Luz UV',
  pesaje: 'Pesaje',
  viables: 'Monitoreo viable',
  'no-viables': 'Monitoreo no viable',
  'ajuste-operario': 'Ajuste (operario)',
  'ajuste-mantenimiento': 'Ajuste (mantenimiento)',
  formato: 'Cambio de formato',
  refrigerio: 'Alimentación del personal',
  alistamiento: 'Alistamiento inicial',
  despeje: 'Despeje de área',
  aseo: 'Aseo de área',
  frasco: 'Frasco o vial',
  laboratorio: 'Laboratorio',
  equipo: 'Equipo',
  otra: 'Otra',
} as const;

export type OtIcono = keyof typeof OT_ICONOS;

/** Ruta de la imagen si el ícono es un pictograma; null si es un ícono de Tabler. */
export function otPictograma(icono: string | null | undefined): string | null {
  return icono && Object.prototype.hasOwnProperty.call(OT_PICTOGRAMAS, icono) ? OT_PICTOGRAMAS[icono as keyof typeof OT_PICTOGRAMAS] : null;
}

export function isOtIcono(v: unknown): v is OtIcono {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(OT_ICONOS, v);
}

/**
 * Catálogo de Farmalógica según su especificación oficial (2026-10-13):
 * 3 alimentaciones con su pictograma + 10 intervenciones («Descargue autoclave»
 * venía repetido) + «Otra». Debe coincidir con
 * prisma/manual/2026-10-13-bitacora-proceso-p0-farmalogica.sql.
 * El 2026-10-14 (A6) se agregan «Alistamiento inicial» (primero), «Despeje de
 * área (fin de lote)» y «Aseo de área» (al final): ver OT_ACTIVIDADES_A6.
 * `exigeObservacion` es histórico (siembra del 10-13): desde el 2026-10-14 la observación es OPCIONAL en todas y la regla ya no lo aplica.
 */
export const OT_CATALOGO_FARMALOGICA: ReadonlyArray<{ nombre: string; icono: OtIcono; orden: number; exigeObservacion: boolean }> = [
  { nombre: 'Alimentación Tapón', icono: 'pictograma-tapon', orden: 10, exigeObservacion: false },
  { nombre: 'Alimentación MPrima', icono: 'pictograma-mprima', orden: 20, exigeObservacion: false },
  { nombre: 'Alimentación Agrafe', icono: 'pictograma-agrafe', orden: 30, exigeObservacion: false },
  { nombre: 'Controles en proceso', icono: 'control', orden: 40, exigeObservacion: false },
  { nombre: 'Descargue Autoclave', icono: 'autoclave', orden: 50, exigeObservacion: false },
  { nombre: 'Descargue de UV', icono: 'uv', orden: 60, exigeObservacion: false },
  { nombre: 'Pesaje de bidones', icono: 'pesaje', orden: 70, exigeObservacion: false },
  { nombre: 'Monitoreos Viables', icono: 'viables', orden: 80, exigeObservacion: false },
  { nombre: 'Monitoreos no Viables', icono: 'no-viables', orden: 90, exigeObservacion: false },
  { nombre: 'Ajuste de equipo Operario', icono: 'ajuste-operario', orden: 100, exigeObservacion: false },
  { nombre: 'Ajuste de equipo por Mantenimiento', icono: 'ajuste-mantenimiento', orden: 110, exigeObservacion: false },
  { nombre: 'Cambio de Formato', icono: 'formato', orden: 120, exigeObservacion: false },
  { nombre: 'Refrigerio/almuerzo/cena', icono: 'refrigerio', orden: 130, exigeObservacion: false },
  { nombre: 'Otra', icono: 'otra', orden: 990, exigeObservacion: true },
];

/** Actividades nuevas de la reunión del 2026-10-14 (A6). Siembra idempotente por nombre. */
export const OT_ACTIVIDADES_A6: ReadonlyArray<{ nombre: string; icono: OtIcono; orden: number }> = [
  { nombre: 'Alistamiento inicial', icono: 'alistamiento', orden: 5 },
  { nombre: 'Despeje de área (fin de lote)', icono: 'despeje', orden: 900 },
  { nombre: 'Aseo de área', icono: 'aseo', orden: 910 },
];

/** Área predefinida de Farmalógica (A5): por ahora la única. */
export const OT_AREAS_FARMALOGICA: ReadonlyArray<string> = ['Envase y agrafado'];

/**
 * Significado de cada confirmación de la bitácora (supervisor al cerrar, jefe de
 * producción al verificar). En la base el rol del verificador sigue siendo
 * `INSPECTOR` (no se renombran columnas); en pantalla, avisos, informe y MCP se
 * muestra «Jefe de producción» (Nicolás, 2026-10-14).
 */
export const OT_FIRMA_SIGNIFICADO = { SUPERVISOR: 'Cerró', INSPECTOR: 'Verificó' } as const;
export type OtFirmaRol = keyof typeof OT_FIRMA_SIGNIFICADO;

/** Etiqueta visible de cada rol. */
export const OT_ROL_LABEL: Record<OtFirmaRol, string> = { SUPERVISOR: 'Supervisor', INSPECTOR: 'Jefe de producción' };

/** Etiqueta del rol del verificador (columna interna `id_inspector`). */
export const OT_JEFE_PRODUCCION_LABEL = 'Jefe de producción';

/** Texto de la casilla de confirmación por rol (A4: check, no firma con imagen). */
export const OT_CONFIRMACION_TEXTO: Record<OtFirmaRol, string> = {
  SUPERVISOR: 'Confirmo que revisé los registros de este turno y cierro la bitácora («Cerró»).',
  INSPECTOR: 'Confirmo que verifiqué la bitácora cerrada por el supervisor («Verificó»).',
};
