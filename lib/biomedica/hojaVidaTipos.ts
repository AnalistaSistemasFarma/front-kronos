/** Constantes de la hoja de vida y los mantenimientos (fase 3, 2026-11-23), sin dependencias: se usan también en el navegador. */

export const ACTIVIDAD_INSPECCION = 'Inspección de equipos biomédicos nuevos';
export const ACTIVIDAD_HOJA_VIDA = 'Elaboración y actualización de hojas de vida';
export const ACTIVIDAD_LIBERACION = 'Liberación de equipos';

export const TIPOS_MANTENIMIENTO = ['preventivo', 'correctivo', 'metrologico'] as const;
export type TipoMantenimiento = (typeof TIPOS_MANTENIMIENTO)[number];
export const ETIQUETA_TIPO: Record<TipoMantenimiento, string> = { preventivo: 'Preventivo', correctivo: 'Correctivo', metrologico: 'Metrológico' };

export const RESULTADOS_CHEQUEO = ['ok', 'no_ok', 'na'] as const;
export type ResultadoChequeo = (typeof RESULTADOS_CHEQUEO)[number];
export const ETIQUETA_RESULTADO: Record<ResultadoChequeo, string> = { ok: 'OK', no_ok: 'No OK', na: 'N/A' };
/** Lista de chequeo sugerida (se puede quitar o agregar ítems en cada mantenimiento). */
export const CHEQUEO_SUGERIDO = ['Estado físico', 'Pantalla', 'Cableado', 'Batería', 'Alarmas', 'Limpieza y desinfección'] as const;
export const MAX_CHEQUEO = 40;

export interface ItemChequeo {
  item: string;
  resultado: ResultadoChequeo;
  nota: string | null;
}

export const ACCION_HISTORIAL: Record<string, string> = {
  alta: 'Ingreso al inventario',
  edicion: 'Edición de datos',
  cambio_serial: 'Cambio de serial',
  distribuir: 'Distribuido',
  devolver: 'Devuelto a bodega',
  faltante: 'Marcado faltante',
  danado: 'Marcado dañado',
  reintegrar: 'Reintegrado',
  hoja_vida: 'Hoja de vida actualizada',
  mantenimiento: 'Mantenimiento',
  mantenimiento_anulado: 'Mantenimiento anulado',
  articulo_sap: 'Artículo de SAP',
  carga: 'Ingreso por cargue masivo',
  carga_cambio: 'Actualizado por cargue masivo',
  liberacion: 'Liberado tras acondicionamiento',
};
export const etiquetaAccion = (a: string) => ACCION_HISTORIAL[a] ?? a.replace(/_/g, ' ');
