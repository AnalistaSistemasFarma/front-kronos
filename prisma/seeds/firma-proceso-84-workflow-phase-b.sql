/*
  FASE B (opcional) — cadena autorización → aceptar turno por rol.
  Ejecutar DESPUÉS de firma-proceso-84-workflow.sql.

  Nota: Orion sigue usando la plantilla id=120 (nombre con "firma").
  Las tareas "Aceptar turno — *" no usan la palabra firma para no confundir el motor Orion.
  Asigne responsables en Admin → Flujos después de ejecutar este script.
*/

DECLARE @ProcessId INT = 84;
DECLARE @TypeAbogado INT = (SELECT id FROM types_authorization WHERE type_authorization = N'Firma — Abogado');
DECLARE @TypeDueno INT = (SELECT id FROM types_authorization WHERE type_authorization = N'Firma — Dueño');
DECLARE @TypeGerente INT = (SELECT id FROM types_authorization WHERE type_authorization = N'Firma — Gerente');
DECLARE @TypeEmpleado INT = (SELECT id FROM types_authorization WHERE type_authorization = N'Firma — Empleado');

-- Autorización previa — Abogado (orden 1)
IF NOT EXISTS (SELECT 1 FROM task_process_category WHERE id_process_category = @ProcessId AND task = N'Autorización previa — Abogado')
BEGIN
  INSERT INTO task_process_category
    (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
  VALUES
    (N'Autorización previa — Abogado', @ProcessId, 1, 0, NULL, 1, 1, 1, @TypeAbogado);
END

-- Aceptar turno — Abogado (orden 2)
IF NOT EXISTS (SELECT 1 FROM task_process_category WHERE id_process_category = @ProcessId AND task = N'Aceptar turno — Abogado')
BEGIN
  INSERT INTO task_process_category
    (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
  VALUES
    (N'Aceptar turno — Abogado', @ProcessId, 1, 0, NULL, 1, 2, 0, NULL);
END

-- Autorización previa — Dueño (orden 3)
IF NOT EXISTS (SELECT 1 FROM task_process_category WHERE id_process_category = @ProcessId AND task = N'Autorización previa — Dueño')
BEGIN
  INSERT INTO task_process_category
    (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
  VALUES
    (N'Autorización previa — Dueño', @ProcessId, 1, 0, NULL, 1, 3, 1, @TypeDueno);
END

IF NOT EXISTS (SELECT 1 FROM task_process_category WHERE id_process_category = @ProcessId AND task = N'Aceptar turno — Dueño')
BEGIN
  INSERT INTO task_process_category
    (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
  VALUES
    (N'Aceptar turno — Dueño', @ProcessId, 1, 0, NULL, 1, 4, 0, NULL);
END

IF NOT EXISTS (SELECT 1 FROM task_process_category WHERE id_process_category = @ProcessId AND task = N'Autorización previa — Gerente')
BEGIN
  INSERT INTO task_process_category
    (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
  VALUES
    (N'Autorización previa — Gerente', @ProcessId, 1, 0, NULL, 1, 5, 1, @TypeGerente);
END

IF NOT EXISTS (SELECT 1 FROM task_process_category WHERE id_process_category = @ProcessId AND task = N'Aceptar turno — Gerente')
BEGIN
  INSERT INTO task_process_category
    (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
  VALUES
    (N'Aceptar turno — Gerente', @ProcessId, 1, 0, NULL, 1, 6, 0, NULL);
END

IF NOT EXISTS (SELECT 1 FROM task_process_category WHERE id_process_category = @ProcessId AND task = N'Autorización previa — Empleado')
BEGIN
  INSERT INTO task_process_category
    (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
  VALUES
    (N'Autorización previa — Empleado', @ProcessId, 1, 0, NULL, 1, 7, 1, @TypeEmpleado);
END

IF NOT EXISTS (SELECT 1 FROM task_process_category WHERE id_process_category = @ProcessId AND task = N'Aceptar turno — Empleado')
BEGIN
  INSERT INTO task_process_category
    (task, id_process_category, active, cost, cost_center, is_sequential, display_order, is_authorization, type_authorization)
  VALUES
    (N'Aceptar turno — Empleado', @ProcessId, 1, 0, NULL, 1, 8, 0, NULL);
END

PRINT 'Fase B: tareas de autorización + aceptar turno creadas en proceso 84. Asigne responsables en el admin de flujos.';
