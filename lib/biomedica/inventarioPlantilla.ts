// Solo tipos: la librería (~900 KB) se descarga al generar la plantilla, no al abrir la pantalla.
import type { PlantillaModelo } from './inventario';

/**
 * Plantilla del cargue masivo del inventario biomédico (2026-11-10), con las columnas del formato
 * OLP-GCC-04-FR-017. Como en el cargue masivo del SGC: hoja de datos, instrucciones y catálogo. Basta
 * la serie, el modelo y la ubicación: si el modelo ya está en el inventario, el equipo, el código, la
 * marca y la clasificación se completan solos.
 */

export const PLANTILLA_INVENTARIO_NOMBRE = 'plantilla-inventario-equipos-biomedicos-FR-017.xlsx';

export const COLUMNAS_PLANTILLA: { header: string; obligatoria: string; ayuda: string; ancho: number }[] = [
  { header: 'CODIGO INTERNO', obligatoria: 'No', ayuda: 'Código del material. Si el modelo ya existe, se toma el suyo.', ancho: 16 },
  { header: 'EQUIPO', obligatoria: 'Sí (o el modelo)', ayuda: 'Tipo de equipo (p. ej. BOMBA DE INFUSION). Si el modelo ya existe, se toma el suyo.', ancho: 30 },
  { header: 'MARCA', obligatoria: 'No', ayuda: 'Si el modelo ya existe, se toma la suya.', ancho: 14 },
  { header: 'MODELO', obligatoria: 'Recomendada', ayuda: 'Uno de la hoja «Modelos» (o uno nuevo, con su equipo).', ancho: 30 },
  { header: 'SERIE', obligatoria: 'Sí', ayuda: 'Única: identifica el equipo. Si ya está en el inventario, la fila ACTUALIZA ese equipo.', ancho: 20 },
  { header: 'CLASIFICACION DE RIESGO', obligatoria: 'No', ayuda: 'I, IIA, IIB o III. Si el modelo ya existe, se toma la suya.', ancho: 14 },
  { header: 'REGISTRO SANITARIO', obligatoria: 'No', ayuda: 'Si aplica.', ancho: 18 },
  { header: 'CLIENTE', obligatoria: 'No', ayuda: 'Dueño o cliente donde está el equipo.', ancho: 34 },
  { header: 'SEDE', obligatoria: 'No', ayuda: '«Bodega» = en bodega; otra sede = distribuido. Vacía = bodega.', ancho: 40 },
  { header: 'ZONA', obligatoria: 'No', ayuda: '', ancho: 12 },
  { header: 'CIUDAD', obligatoria: 'No', ayuda: '', ancho: 16 },
];

export async function construirPlantillaInventario(empresa: string, plantillas: Record<string, PlantillaModelo>): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SynerLink · Ingeniería biomédica';
  const hoja = wb.addWorksheet('Inventario');
  hoja.addRow(COLUMNAS_PLANTILLA.map((c) => c.header));
  hoja.getRow(1).font = { bold: true };
  hoja.columns.forEach((col, i) => {
    col.width = COLUMNAS_PLANTILLA[i]?.ancho ?? 16;
  });
  hoja.views = [{ state: 'frozen', ySplit: 1 }];

  const ayuda = wb.addWorksheet('Instrucciones');
  ayuda.addRow([`Inventario de equipos biomédicos (OLP-GCC-04-FR-017)${empresa ? ` · ${empresa}` : ''}`]).font = { bold: true, size: 13 };
  ayuda.addRow(['Llene la hoja «Inventario»: una fila por equipo. La fila 1 son los encabezados y no se cambia.']);
  ayuda.addRow(['Basta la SERIE, el MODELO y la ubicación (cliente, sede, ciudad): si el modelo ya está en el inventario, el resto se completa solo.']);
  ayuda.addRow(['Al cargar, primero se SIMULA: verá qué es nuevo, qué cambia y qué filas tienen error. No se escribe nada hasta «Cargar».']);
  ayuda.addRow(['Si una serie ya está en el inventario, la fila actualiza ese equipo (con justificación). Un equipo faltante o dañado no lo cambia el archivo.']);
  ayuda.addRow([]);
  ayuda.addRow(['Columna', 'Obligatoria', 'Qué escribir']).font = { bold: true };
  for (const c of COLUMNAS_PLANTILLA) ayuda.addRow([c.header, c.obligatoria, c.ayuda]);
  ayuda.columns.forEach((col, i) => {
    col.width = [26, 18, 90][i] ?? 20;
  });

  const modelos = wb.addWorksheet('Modelos');
  modelos.addRow(['MODELO', 'EQUIPO', 'CODIGO INTERNO', 'MARCA', 'CLASIFICACION DE RIESGO']).font = { bold: true };
  for (const [m, p] of Object.entries(plantillas).sort(([a], [b]) => a.localeCompare(b, 'es'))) {
    modelos.addRow([m, p.equipo ?? '', p.codigoInterno ?? '', p.marca ?? '', p.clasificacionRiesgo ?? '']);
  }
  modelos.columns.forEach((col, i) => {
    col.width = [34, 32, 16, 14, 14][i] ?? 16;
  });
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
