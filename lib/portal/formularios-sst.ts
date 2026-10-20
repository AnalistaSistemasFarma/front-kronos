/**
 * PORTAL TH — FORMULARIOS SST — registro de los formularios independientes (Cristian Baldión, 2026-10-20).
 *
 * «Reporte de actos y condiciones inseguras SST» y «Condiciones de salud y sintomatología osteomuscular»: formularios PROPIOS del portal,
 * replicados de Microsoft Forms, que NO pertenecen a un curso. Cada envío se guarda como un archivo en SharePoint (carpeta
 * `FORMULARIOS SST`; ver `formularios-sst-servidor.ts`) y solo lo ven quienes define `formularios-sst-permisos.ts`.
 *
 * Este archivo es PURO (sin red ni base): sirve al servidor y al navegador. La definición de cada formulario es un JSON de
 * `lib/portal/formularios/` con el mismo formato de los formularios de Formación, así que se dibujan con la misma pantalla.
 */
import condicionesSalud from './formularios/sst-condiciones-salud-osteomuscular.json';
import reporteActos from './formularios/sst-reporte-actos-condiciones.json';
import { validarDefinicion, type DefinicionFormulario, type Respuestas } from './formulario';

export interface FormularioSst {
  codigo: string;
  titulo: string;
  descripcion: string | null;
  /** Lleva datos de salud: exige la autorización de tratamiento de datos (Ley 1581 de 2012). */
  datosSensibles: boolean;
  definicion: DefinicionFormulario;
}

function cargar(crudo: unknown): FormularioSst {
  const r = validarDefinicion(crudo);
  if (!r.ok) throw new Error(`Formulario SST no válido: ${r.errores.join(' | ')}`);
  const d = r.definicion;
  return { codigo: d.codigo, titulo: d.titulo, descripcion: d.descripcion ?? null, datosSensibles: d.datosSensibles === true, definicion: d };
}

/** Los formularios SST disponibles, en el orden en que se muestran. */
export const FORMULARIOS_SST: readonly FormularioSst[] = [cargar(reporteActos), cargar(condicionesSalud)];

/** El formulario con ese código, o null (también si el valor no es un texto). */
export function formularioSst(codigo: unknown): FormularioSst | null {
  return typeof codigo === 'string' ? (FORMULARIOS_SST.find((f) => f.codigo === codigo) ?? null) : null;
}

/** Lo que se guarda en cada archivo de SharePoint (un envío). */
export interface EnvioSstGuardado {
  v: 1;
  codigo: string;
  /** Huella de la definición que la persona vio (si el formulario cambia, se sabe con cuál contestó). */
  definicion: string;
  /** Correo de la SESIÓN de quien envía (nunca el que diga el formulario). */
  enviadoPor: string;
  enviadoEl: string;
  autorizacion: { version: string; aceptadoEl: string } | null;
  respuestas: Respuestas;
}

/** Una fila de la tabla de respuestas, tal como llega al navegador de quien puede verlas. */
export interface FilaEnvioSst {
  /** Nombre del archivo: identifica el envío. */
  id: string;
  correo: string;
  enviadaEl: string;
  autorizacionVersion: string | null;
  respuestas: Respuestas;
}

export interface TablaEnviosSst {
  formulario: { codigo: string; titulo: string };
  columnas: { id: string; texto: string }[];
  filas: FilaEnvioSst[];
  /** Cuántos envíos hay en total (puede ser más que `filas`). */
  total: number;
  /** Hay más envíos de los que se leyeron: los más recientes están primero. */
  truncado: boolean;
}

/** Límites de lectura: la tabla muestra los más recientes; el Excel llega más lejos. */
export const LIMITE_TABLA_SST = 500;
export const LIMITE_EXCEL_SST = 2000;
/** Máximo de envíos por persona y por formulario en un mismo día (protege la carpeta de SharePoint de abusos). */
export const MAX_ENVIOS_POR_DIA_SST = 20;
