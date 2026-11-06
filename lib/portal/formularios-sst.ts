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

/** Arma un formulario SST a partir de su definición; lanza si no es válida (las mismas reglas que los formularios de Formación). */
export function cargarFormularioSst(crudo: unknown): FormularioSst {
  const r = validarDefinicion(crudo);
  if (!r.ok) throw new Error(`Formulario SST no válido: ${r.errores.join(' | ')}`);
  const d = r.definicion;
  return { codigo: d.codigo, titulo: d.titulo, descripcion: d.descripcion ?? null, datosSensibles: d.datosSensibles === true, definicion: d };
}

/**
 * Los formularios SST que vienen EN EL CÓDIGO (B1 y B2), en el orden en que se muestran. Los botones de la página principal dependen de
 * ellos, así que siempre existen. Una definición guardada en SharePoint con el mismo código los reemplaza (ver `formularios-sst-catalogo.ts`).
 */
export const FORMULARIOS_SST: readonly FormularioSst[] = [cargarFormularioSst(reporteActos), cargarFormularioSst(condicionesSalud)];

/** De dónde sale un formulario: del código (`base`) o de lo que el administrador creó o editó en el constructor (`personalizado`). */
export type OrigenFormularioSst = 'base' | 'personalizado';

export interface FormularioSstActual extends FormularioSst {
  origen: OrigenFormularioSst;
  /** Cuándo se guardó la versión vigente desde el constructor; null si es la del código sin cambios. */
  guardadoEl: string | null;
  /** Si el administrador reemplazó una de las del código. */
  editado: boolean;
}

/** Código de un formulario NUEVO: se usa como nombre de carpeta en SharePoint, así que solo letras, números, guión y guión bajo. */
export const CODIGO_FORMULARIO_SST = /^[A-Za-z0-9][A-Za-z0-9_-]{2,59}$/;
/** Nombres que no se pueden usar como código: son carpetas del propio sistema. */
export const CODIGOS_RESERVADOS_SST = ['definiciones'] as const;
export const MAX_FORMULARIOS_SST_PERSONALIZADOS = 40;
export const MAX_BYTES_DEFINICION_SST = 200 * 1024;

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
