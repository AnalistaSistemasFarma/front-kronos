import type { SgcCompanyAccess } from './permissions';

/**
 * GENERADOR DE DOCUMENTOS del SGC (2026-10-05, demo PiSA) — funciones PURAS.
 *
 * Retoma el «Generador de Documentos» del módulo documental anterior (Sprint 7
 * y 8, traído del historial de git y adaptado al SGC aislado): se elige un
 * documento VIGENTE, su contenido (el Word fuente convertido o la revisión del
 * editor) se abre como COPIA DE TRABAJO, se modifica y se genera un PDF con el
 * encabezado del documento de origen y una leyenda de trazabilidad.
 *
 * No es un cambio del documento controlado: no crea versión ni solicitud, no
 * pide motivo de cambio y no guarda nada (la generación es efímera). Es el
 * ÚNICO caso del SGC en que se permite descargar, porque lo que se descarga es
 * la versión modificada generada desde la plataforma, no el documento
 * controlado (RN «Ver documento sin descarga», 2026-10-05). Cada generación y
 * cada descarga quedan en sgc.audit_log.
 *
 * Permiso: el mismo de «Solicitar nueva versión» en la ficha — gestión
 * documental (elaborar, revisar y aprobar) o Aseguramiento de Calidad. El
 * módulo anterior usaba un subproceso propio; aquí se reutiliza el existente
 * para no requerir migración ni siembra.
 */

/** ¿Puede usar el generador en esta empresa? */
export function canUseSgcGenerator(access: Pick<SgcCompanyAccess, 'canManage' | 'canQuality'> | null | undefined): boolean {
  return Boolean(access && (access.canManage || access.canQuality));
}

/** Formatos del contenido vigente que se pueden abrir en el editor. */
export type SgcGeneratorSourceFormat = 'docx' | 'html';

/** Formato editable del archivo fuente de una versión, o null (solo PDF o Word antiguo). */
export function generatorSourceFormat(sourceFileName: string | null | undefined): SgcGeneratorSourceFormat | null {
  const n = (sourceFileName ?? '').trim().toLowerCase();
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.html') || n.endsWith('.htm')) return 'html';
  return null;
}

/** Fecha y hora de Colombia (UTC-5, sin horario de verano) como «YYYY-MM-DD HH:mm». */
export function formatGeneratedAt(at: Date): string {
  return new Date(at.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Leyenda de trazabilidad que va al pie de cada página del PDF generado. */
export function generatorLegend(input: { code: string; versionNumber: number; user: string; at: Date }): string {
  return `Documento generado a partir de ${input.code} v${input.versionNumber} · ${input.user} · ${formatGeneratedAt(input.at)} · No es copia controlada`;
}

/** Nombre del archivo descargado. */
export function generatorFileName(code: string, versionNumber: number, at: Date): string {
  const stamp = formatGeneratedAt(at).replace(/[-: ]/g, '').slice(0, 12);
  return `${code} V${versionNumber} - generado ${stamp}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
}

export const SGC_GENERATOR_MODES = ['vista', 'descarga'] as const;
export type SgcGeneratorMode = (typeof SGC_GENERATOR_MODES)[number];

export function parseGeneratorMode(value: unknown): SgcGeneratorMode | null {
  return typeof value === 'string' && (SGC_GENERATOR_MODES as readonly string[]).includes(value) ? (value as SgcGeneratorMode) : null;
}
