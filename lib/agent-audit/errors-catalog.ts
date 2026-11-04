/**
 * Catálogo de los ERRORES DE IA (Auditoría de agentes), sin dependencias: lo
 * usan la pantalla (cliente) y la lógica del servidor (errors.ts).
 */
export const TIPOS_ERROR = [
  'turno_fallido', // el puente openclaw no pudo completar el turno (incluye «excedió Ns»)
  'puente_hilos', // error del puente de hilos (~/.puente-hilos/*/logs)
  'sesion_vencida', // 401 / «Please run /login»
  'limite_uso', // «hit your limit», 429, tope de gasto
  'conector_caido', // MCP «giving up», EHOSTDOWN, «failed to connect», conectores de canal caídos
  'congelado_confirmacion', // TUI detenida en «Do you want to proceed?» / «❯ 1. Yes»
  'sin_entregar', // conversación con mensajes de personas sin contestar
  'recibe_no_envia', // recibe pero contesta en su consola, sin reply
  'puente_caido', // el puente no puede hablar con SynerLink (401 de la llave, 500 sostenido)
  'herramienta', // una herramienta (MCP) falló dentro de un turno
  'automatizacion', // una automatización programada dejó de correr o falla (Indicador → programadas, 2026-11-04)
  'otro',
] as const;
export type TipoError = (typeof TIPOS_ERROR)[number];

export const SEVERIDADES = ['alta', 'media', 'baja'] as const;
export type Severidad = (typeof SEVERIDADES)[number];

export const ESTADOS = ['abierto', 'resuelto', 'silenciado'] as const;
export type EstadoError = (typeof ESTADOS)[number];

export const AMBIENTES = ['prod', 'pruebas'] as const;
export type Ambiente = (typeof AMBIENTES)[number];

/** Nombres para la pantalla y la notificación. */
export const NOMBRE_TIPO: Record<TipoError, string> = {
  turno_fallido: 'Turno fallido',
  puente_hilos: 'Puente de hilos',
  sesion_vencida: 'Sesión vencida',
  limite_uso: 'Límite de uso',
  conector_caido: 'Conector caído',
  congelado_confirmacion: 'Congelado en una confirmación',
  sin_entregar: 'Mensajes sin contestar',
  recibe_no_envia: 'Recibe pero no envía',
  puente_caido: 'Puente sin conexión',
  herramienta: 'Herramienta fallida',
  automatizacion: 'Automatización programada',
  otro: 'Otro',
};

