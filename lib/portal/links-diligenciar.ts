/**
 * PORTAL TH — «LINKS PARA DILIGENCIAR EN CASO DE SER REQUERIDO» (Cristian Baldión, 2026-10-20).
 *
 * Bajo la tarjeta «Formación» de la página principal van dos botones que abren, en una ventana, los formularios propios de Seguridad y
 * Salud en el Trabajo (B1 y B2). El texto de cada botón es el que pidió Cristian y NO depende de la API: el botón se pinta aunque la
 * lista de formularios no responda. El código de cada botón debe existir en `FORMULARIOS_SST` (hay una prueba que lo exige).
 */
export const TITULO_LINKS_DILIGENCIAR = 'LINKS PARA DILIGENCIAR EN CASO DE SER REQUERIDO';

export interface LinkDiligenciar {
  /** Código del formulario en `lib/portal/formularios-sst.ts`. */
  codigo: string;
  /** Lo que dice el botón. */
  texto: string;
}

export const LINKS_DILIGENCIAR: readonly LinkDiligenciar[] = [
  { codigo: 'SST-REPORTE-ACTOS', texto: 'REPORTE DE ACTOS Y CONDICIONES INSEGURAS SST' },
  { codigo: 'SST-SALUD-OSTEOMUSCULAR', texto: 'CONDICIONES DE SALUD Y SINTOMATOLOGÍA OSTEOMUSCULAR' },
];

/** La ruta de la API que entrega la definición y recibe el envío de un formulario SST. */
export const rutaApiFormularioSst = (codigo: string) => `/api/portal/formularios-sst/${encodeURIComponent(codigo)}`;

/** Página con todos los formularios SST y, para quien tiene permiso, sus respuestas. */
export const RUTA_PAGINA_FORMULARIOS_SST = '/portal/formularios-sst';
