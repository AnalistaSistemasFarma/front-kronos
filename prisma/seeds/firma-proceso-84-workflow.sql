/*
  Proceso FIRMA — firmas proceso (process_category id = 84)
  Fase A operativa: una tarea secuencial de preparación + tipos de autorización para Fase B.

  Ejecutar contra la BD de SynerLink (SQL Server).
*/

DECLARE @ProcessId INT = 84;

-- Desactivar tareas obsoletas / incorrectas
UPDATE task_process_category
SET active = 0
WHERE id_process_category = @ProcessId
  AND id IN (119, 121);

-- Tarea 1: preparación (Orion usa plantillas cuyo nombre contiene "firma")
UPDATE task_process_category
SET
  task = N'Preparar documento y firmantes',
  display_order = 0,
  is_sequential = 1,
  is_authorization = 0,
  type_authorization = NULL,
  active = 1
WHERE id = 120;

-- Tipos de autorización para flujo FIRMA (Fase B)
IF NOT EXISTS (SELECT 1 FROM types_authorization WHERE type_authorization = N'Firma — Abogado')
  INSERT INTO types_authorization (type_authorization) VALUES (N'Firma — Abogado');

IF NOT EXISTS (SELECT 1 FROM types_authorization WHERE type_authorization = N'Firma — Dueño')
  INSERT INTO types_authorization (type_authorization) VALUES (N'Firma — Dueño');

IF NOT EXISTS (SELECT 1 FROM types_authorization WHERE type_authorization = N'Firma — Gerente')
  INSERT INTO types_authorization (type_authorization) VALUES (N'Firma — Gerente');

IF NOT EXISTS (SELECT 1 FROM types_authorization WHERE type_authorization = N'Firma — Empleado')
  INSERT INTO types_authorization (type_authorization) VALUES (N'Firma — Empleado');

IF NOT EXISTS (SELECT 1 FROM types_authorization WHERE type_authorization = N'Firma — Aprobación envío')
  INSERT INTO types_authorization (type_authorization) VALUES (N'Firma — Aprobación envío');

PRINT 'Flujo FIRMA (proceso 84) actualizado — Fase A activa. Tipos Firma — * listos para Fase B.';
