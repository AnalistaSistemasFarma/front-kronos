/*
  REVERSA de 2026-10-19-combine-workflows (flujos vinculados, PR #673/#679/#681).
  Quita dbo.task_process_category.id_linked_process y dbo.requests_general.id_origin_task, con sus FK
  (cualquiera sea su nombre). Correr DESPUÉS de volver al código anterior.
  ⚠️ SE NIEGA (THROW 51493) si alguna fila tiene valor en esas columnas: se perdería qué tarea abre
  qué flujo y qué solicitud viene de qué tarea. Exporte antes:
    SELECT id, id_linked_process FROM dbo.task_process_category WHERE id_linked_process IS NOT NULL;
    SELECT id, id_origin_task FROM dbo.requests_general WHERE id_origin_task IS NOT NULL;
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51492, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @tpc INT = 0, @rg INT = 0;
IF COL_LENGTH(N'dbo.task_process_category', N'id_linked_process') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[task_process_category] WHERE [id_linked_process] IS NOT NULL', N'@n INT OUTPUT', @n = @tpc OUTPUT;
IF COL_LENGTH(N'dbo.requests_general', N'id_origin_task') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[requests_general] WHERE [id_origin_task] IS NOT NULL', N'@n INT OUTPUT', @n = @rg OUTPUT;
SELECT DB_NAME() AS base, 'antes' AS momento, @tpc AS tareas_con_flujo_vinculado, @rg AS solicitudes_con_tarea_origen;
IF @tpc > 0 OR @rg > 0
  THROW 51493, N'Hay filas con valor en id_linked_process o id_origin_task: no se quitan las columnas (solo se quitan si todas están en NULL).', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @fk SYSNAME, @tabla SYSNAME, @sql NVARCHAR(600);
  DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT fk.name, OBJECT_NAME(fk.parent_object_id)
    FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
    JOIN sys.columns pc ON pc.object_id = fc.parent_object_id AND pc.column_id = fc.parent_column_id
    WHERE (fk.parent_object_id = OBJECT_ID(N'dbo.task_process_category') AND pc.name = N'id_linked_process')
       OR (fk.parent_object_id = OBJECT_ID(N'dbo.requests_general') AND pc.name = N'id_origin_task');
  OPEN c; FETCH NEXT FROM c INTO @fk, @tabla;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @sql = N'ALTER TABLE [dbo].' + QUOTENAME(@tabla) + N' DROP CONSTRAINT ' + QUOTENAME(@fk) + N';';
    EXEC sp_executesql @sql;
    FETCH NEXT FROM c INTO @fk, @tabla;
  END
  CLOSE c; DEALLOCATE c;
  IF COL_LENGTH(N'dbo.task_process_category', N'id_linked_process') IS NOT NULL
    ALTER TABLE [dbo].[task_process_category] DROP COLUMN [id_linked_process];
  IF COL_LENGTH(N'dbo.requests_general', N'id_origin_task') IS NOT NULL
    ALTER TABLE [dbo].[requests_general] DROP COLUMN [id_origin_task];
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento,
       COL_LENGTH(N'dbo.task_process_category', N'id_linked_process') AS tpc_id_linked_process,
       COL_LENGTH(N'dbo.requests_general', N'id_origin_task') AS rg_id_origin_task;
