/**
 * PLANTILLA INSTITUCIONAL DE PROCEDIMIENTO (Calidad de One Latam Pharma,
 * enviada por Juan Sebastián Mora el 2026-10-02: «Platilla para
 * procedimiento.docx»), como punto de partida del borrador en el editor.
 *
 * El ENCABEZADO de la plantilla (logo, código, página x de y, elaboró,
 * revisó, aprobó con su recuadro «Firma», fecha de emisión y proceso) no va
 * aquí: lo dibuja el sistema al generar el PDF controlado (plantilla
 * institucional, lib/sgc/pdf/institutional.ts). Aquí van las secciones del
 * cuerpo con las instrucciones de Calidad entre corchetes y las marcas de
 * campos de sistema ({{NOMBRE_DOCUMENTO}}, {{HISTORIAL_CAMBIOS}}), que el
 * sistema llena al aprobar. La numeración de la plantilla original se
 * normalizó (1 a 10) sin cambiar títulos ni instrucciones.
 */
export const SGC_PROCEDURE_TEMPLATE_HTML = [
  '<p><strong>Nombre del documento:</strong> {{NOMBRE_DOCUMENTO}}</p>',
  '<h2>1. OBJETIVO</h2>',
  '<p>Establecer las instrucciones, metodologías y criterios estandarizados para la correcta ejecución de [Nombre del procedimiento], garantizando el cumplimiento de los estándares de calidad, seguridad y normatividad vigentes.</p>',
  '<h2>2. ALCANCE</h2>',
  '<p>Aplicación a todo el personal, áreas y procesos involucrados en [describir brevemente las actividades, áreas o equipos donde aplica este procedimiento] dentro de la organización.</p>',
  '<h2>3. TÉRMINOS Y DEFINICIONES</h2>',
  '<p>Conceptos clave y abreviaturas requeridas para la comprensión y aplicación de este procedimiento:</p>',
  '<ul><li><p>[Término 1]: [Definición técnica o funcional].</p></li><li><p>[Término 2]: [Definición técnica o funcional].</p></li><li><p>POE: Procedimiento Operativo Estándar.</p></li></ul>',
  '<h2>4. ENFOQUE DEL PROCESO</h2>',
  '<p>Estructurar y estandarizar la ejecución de [nombre del procedimiento] con un enfoque preventivo y cualitativo, orientando cada fase operativa al aseguramiento de la calidad, la trazabilidad de la información y la mitigación de riesgos operacionales.</p>',
  '<h2>5. CONTENIDO</h2>',
  '<p>Descripción sintética del procedimiento: este documento aborda desde las preparaciones previas y controles de seguridad, hasta el desarrollo analítico/operativo paso a paso, el manejo de residuos y el registro final de datos en la documentación controlada.</p>',
  '<h2>6. PROCEDIMIENTO</h2>',
  '<h3>6.1 Consideraciones generales y de seguridad</h3>',
  '<ul><li><p>Utilizar los Elementos de Protección Personal (EPP) requeridos: [especificar EPP, p. ej.: bata de laboratorio, guantes de nitrilo, gafas de seguridad].</p></li><li><p>Verificar que las condiciones ambientales del área cumplan con las especificaciones antes de iniciar las actividades.</p></li></ul>',
  '<h3>6.2 Equipos, reactivos y materiales</h3>',
  '<ul><li><p>Equipos: [Listar equipos e instrumentos calibrados/calificados a utilizar].</p></li><li><p>Reactivos/Materiales: [Listar reactivos, estándares, cristalería o insumos].</p></li></ul>',
  '<h3>6.3 Paso a paso de la ejecución</h3>',
  '<ul><li><p>Preparación previa: verificar la disponibilidad y vigencia de insumos, reactivos y calibración de equipos.</p></li><li><p>Desarrollo del procedimiento:</p><ul><li><p>Paso 1: [Descripción detallada de la primera acción en verbo en infinitivo, p. ej.: Pesar / Medir / Inspeccionar].</p></li><li><p>Paso 2: [Descripción detallada de la siguiente acción].</p></li><li><p>Paso 3: [Descripción detallada del registro de datos u observaciones].</p></li></ul></li><li><p>Cierre y limpieza: desinfectar/limpiar los equipos y el área de trabajo, y realizar la disposición final de residuos según el protocolo correspondiente.</p></li></ul>',
  '<h2>7. ANEXOS</h2>',
  '<p>Documentos no codificados, diagramas, esquemas o guías complementarias que sirven de apoyo visual o técnico para el desarrollo de la actividad.</p>',
  '<p>Anexo 1: [Nombre o descripción del anexo no codificado].</p>',
  '<h2>8. DOCUMENTOS RELACIONADOS</h2>',
  '<p>Documentos controlados y codificados dentro del Sistema de Gestión de Calidad que se mencionan o se emplean en este procedimiento:</p>',
  '<ul><li><p>[CÓDIGO-001]: [Nombre del formato, instructivo o POE relacionado].</p></li><li><p>[CÓDIGO-002]: [Nombre del formato de registro de datos].</p></li></ul>',
  '<h2>9. REFERENCIAS BIBLIOGRÁFICAS</h2>',
  '<p>Normativas, farmacopeas o guías técnicas que respaldan legal o metodológicamente el procedimiento:</p>',
  '<ul><li><p>[Farmacopea / Norma ISO / Guía ICH / Manual del fabricante aplicable].</p></li></ul>',
  '<h2>10. HISTORIAL DE CAMBIOS</h2>',
  '<p>{{HISTORIAL_CAMBIOS}}</p>',
].join('');

/** Secciones obligatorias de la plantilla (para las pruebas y la verificación). */
export const SGC_PROCEDURE_TEMPLATE_SECTIONS = [
  'OBJETIVO',
  'ALCANCE',
  'TÉRMINOS Y DEFINICIONES',
  'ENFOQUE DEL PROCESO',
  'CONTENIDO',
  'PROCEDIMIENTO',
  'ANEXOS',
  'DOCUMENTOS RELACIONADOS',
  'REFERENCIAS BIBLIOGRÁFICAS',
  'HISTORIAL DE CAMBIOS',
] as const;
