/*
  Sprint 9 (Gestión Documental): siembra el catálogo de CATEGORÍAS DE PROCESO
  DOCUMENTAL y sus sub-procesos en document_process_category /
  document_process_subprocess (tablas nuevas, ver migración
  20260902130000_document_process_categories y el comentario de módulo en
  prisma/schema.prisma junto a DocumentProcessCategory).

  Valores EXACTOS dados por Nicolás para este sprint (no cambiar sin que él
  lo pida): 3 categorías -- Auditorías y Autoinspecciones, No Conformidades,
  Ingeniería Biomédica -- con sus sub-procesos en el orden dado.

  Diseñado para poder AÑADIR más categorías/sub-procesos en el futuro sin
  tocar código: basta con un INSERT nuevo en document_process_category /
  document_process_subprocess (o correr este mismo patrón de seed con datos
  nuevos). Idempotente, APPEND-ONLY (sin DROP/ALTER/TRUNCATE) -- se puede
  re-correr cuantas veces haga falta sin duplicar nada, mismo criterio que
  el resto de los seeds de este módulo (carpeta prisma/seeds).

  Uso:
    node prisma/seeds/run-document-management-process-categories.mjs
*/

DECLARE @Categories TABLE (name NVARCHAR(200), display_order INT);
INSERT INTO @Categories (name, display_order) VALUES
  (N'Auditorías y Autoinspecciones', 1),
  (N'No Conformidades', 2),
  (N'Ingeniería Biomédica', 3);

INSERT INTO [dbo].[document_process_category] (name, display_order, is_active, created_at)
SELECT c.name, c.display_order, 1, GETDATE()
FROM @Categories c
WHERE NOT EXISTS (
  SELECT 1 FROM [dbo].[document_process_category] dpc WHERE dpc.name = c.name
);

DECLARE @Subprocesses TABLE (category_name NVARCHAR(200), name NVARCHAR(200), display_order INT);
INSERT INTO @Subprocesses (category_name, name, display_order) VALUES
  (N'Auditorías y Autoinspecciones', N'Cronograma', 1),
  (N'Auditorías y Autoinspecciones', N'Plan de auditoría', 2),
  (N'Auditorías y Autoinspecciones', N'Asignación de auditores', 3),
  (N'Auditorías y Autoinspecciones', N'Conformación del grupo auditor', 4),
  (N'Auditorías y Autoinspecciones', N'Lista de verificación', 5),
  (N'Auditorías y Autoinspecciones', N'Ejecución de auditoría/autoinspección', 6),
  (N'Auditorías y Autoinspecciones', N'Informe de auditoría/autoinspección', 7),
  (N'Auditorías y Autoinspecciones', N'Seguimiento', 8),
  (N'Auditorías y Autoinspecciones', N'Generación de No Conformidades', 9),
  (N'Auditorías y Autoinspecciones', N'Cierre de auditoría', 10),

  (N'No Conformidades', N'Identificación de No Conformidad', 1),
  (N'No Conformidades', N'Registro', 2),
  (N'No Conformidades', N'Clasificación/Evaluación', 3),
  (N'No Conformidades', N'Investigación y análisis de causa raíz', 4),
  (N'No Conformidades', N'Definición e implementación de acciones correctivas/preventivas/mejora', 5),
  (N'No Conformidades', N'Seguimiento y verificación de efectividad', 6),
  (N'No Conformidades', N'Cierre de la No Conformidad', 7),

  (N'Ingeniería Biomédica', N'Inspección de equipos biomédicos nuevos', 1),
  (N'Ingeniería Biomédica', N'Elaboración y actualización de hojas de vida', 2),
  (N'Ingeniería Biomédica', N'Trazabilidad de equipos biomédicos', 3),
  (N'Ingeniería Biomédica', N'Control de devoluciones', 4),
  (N'Ingeniería Biomédica', N'Liberación de equipos', 5),
  (N'Ingeniería Biomédica', N'Visita técnica', 6),
  (N'Ingeniería Biomédica', N'Mantenimientos preventivos/correctivos/metrológicos', 7),
  (N'Ingeniería Biomédica', N'Cronograma de mantenimiento', 8),
  (N'Ingeniería Biomédica', N'Trazabilidad de repuestos e insumos', 9),
  (N'Ingeniería Biomédica', N'Trazabilidad de inventario de equipos biomédicos', 10);

INSERT INTO [dbo].[document_process_subprocess] (id_document_process_category, name, display_order, is_active, created_at)
SELECT dpc.id, s.name, s.display_order, 1, GETDATE()
FROM @Subprocesses s
JOIN [dbo].[document_process_category] dpc ON dpc.name = s.category_name
WHERE NOT EXISTS (
  SELECT 1 FROM [dbo].[document_process_subprocess] dps
  WHERE dps.id_document_process_category = dpc.id AND dps.name = s.name
);

/* Diagnóstico: qué quedó sembrado. */
SELECT dpc.name AS categoria, dpc.display_order AS orden_categoria,
       dps.name AS subproceso, dps.display_order AS orden_subproceso
FROM [dbo].[document_process_category] dpc
LEFT JOIN [dbo].[document_process_subprocess] dps ON dps.id_document_process_category = dpc.id
ORDER BY dpc.display_order, dps.display_order;
