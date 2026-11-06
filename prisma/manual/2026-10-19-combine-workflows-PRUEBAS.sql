/*
  PASE MANUAL (PRUEBAS) — Solicitudes generales: FLUJOS VINCULADOS (combine workflows). 2026-10-19.
  PR #673 (combine workflows) y #679 (filter process with task), llevados a main por el #681.
  BASE: KRONOSDB_PRUEBAS (o la base efímera kronos_ci de la CI). El script se detiene en cualquier otra base.

  Correr ANTES de desplegar el código en pruebas (.230).

  QUÉ HACE (aditivo e IDEMPOTENTE; informa antes y después):
    - dbo.task_process_category.id_linked_process INT NULL -> FK a dbo.process_category(id)
      (la tarea del flujo abre una solicitud de OTRO proceso);
    - dbo.requests_general.id_origin_task INT NULL -> FK a dbo.task_request_general(id)
      (la solicitud recuerda la tarea que la originó; al cerrarse, cierra esa tarea).
  El código usa estas columnas con consultas mssql directas (no Prisma): schema.prisma no cambia
  y no hay migración que registrar. Sin índices nuevos (tablas pequeñas; igual que PRUEBAS).
  Si la columna ya tiene una FK (creada a mano con nombre de sistema), NO se agrega otra.

  ⚠️ ORDEN: ANTES del código. Sin las columnas falla la creación de solicitudes generales.
  🔒 LOCK_TIMEOUT 5000: si la tabla está tomada (1222) hace ROLLBACK; vuelva a correrlo.
  REVERSA: prisma/manual/2026-10-19-combine-workflows-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51489, N'Base no esperada para este script (PRUEBAS).', 1;
IF OBJECT_ID(N'dbo.task_process_category', N'U') IS NULL OR OBJECT_ID(N'dbo.requests_general', N'U') IS NULL
   OR OBJECT_ID(N'dbo.process_category', N'U') IS NULL OR OBJECT_ID(N'dbo.task_request_general', N'U') IS NULL
  THROW 51491, N'Faltan las tablas base de solicitudes generales.', 1;

SELECT DB_NAME() AS base, 'antes' AS momento,
       COL_LENGTH(N'dbo.task_process_category', N'id_linked_process') AS tpc_id_linked_process,
       COL_LENGTH(N'dbo.requests_general', N'id_origin_task') AS rg_id_origin_task,
       (SELECT COUNT(*) FROM sys.foreign_key_columns fc JOIN sys.columns c ON c.object_id = fc.parent_object_id AND c.column_id = fc.parent_column_id
         WHERE fc.parent_object_id = OBJECT_ID(N'dbo.task_process_category') AND c.name = N'id_linked_process') AS fk_linked_process,
       (SELECT COUNT(*) FROM sys.foreign_key_columns fc JOIN sys.columns c ON c.object_id = fc.parent_object_id AND c.column_id = fc.parent_column_id
         WHERE fc.parent_object_id = OBJECT_ID(N'dbo.requests_general') AND c.name = N'id_origin_task') AS fk_origin_task;

BEGIN TRY
  BEGIN TRANSACTION;
  IF COL_LENGTH(N'dbo.task_process_category', N'id_linked_process') IS NULL
    ALTER TABLE [dbo].[task_process_category] ADD [id_linked_process] INT NULL;
  IF COL_LENGTH(N'dbo.requests_general', N'id_origin_task') IS NULL
    ALTER TABLE [dbo].[requests_general] ADD [id_origin_task] INT NULL;

  -- FK solo si la columna no tiene ninguna (en PRUEBAS y PROD ya existen con nombre de sistema,
  -- creadas a mano el 2026-10-19: no se duplican). EXEC: la columna puede ser de este lote.
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns c ON c.object_id = fc.parent_object_id AND c.column_id = fc.parent_column_id
                 WHERE fc.parent_object_id = OBJECT_ID(N'dbo.task_process_category') AND c.name = N'id_linked_process')
    EXEC(N'ALTER TABLE [dbo].[task_process_category] WITH CHECK ADD CONSTRAINT [task_process_category_id_linked_process_fkey]
      FOREIGN KEY ([id_linked_process]) REFERENCES [dbo].[process_category]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns c ON c.object_id = fc.parent_object_id AND c.column_id = fc.parent_column_id
                 WHERE fc.parent_object_id = OBJECT_ID(N'dbo.requests_general') AND c.name = N'id_origin_task')
    EXEC(N'ALTER TABLE [dbo].[requests_general] WITH CHECK ADD CONSTRAINT [requests_general_id_origin_task_fkey]
      FOREIGN KEY ([id_origin_task]) REFERENCES [dbo].[task_request_general]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento,
       COL_LENGTH(N'dbo.task_process_category', N'id_linked_process') AS tpc_id_linked_process,
       COL_LENGTH(N'dbo.requests_general', N'id_origin_task') AS rg_id_origin_task,
       (SELECT COUNT(*) FROM sys.foreign_key_columns fc JOIN sys.columns c ON c.object_id = fc.parent_object_id AND c.column_id = fc.parent_column_id
         WHERE fc.parent_object_id = OBJECT_ID(N'dbo.task_process_category') AND c.name = N'id_linked_process') AS fk_linked_process,
       (SELECT COUNT(*) FROM sys.foreign_key_columns fc JOIN sys.columns c ON c.object_id = fc.parent_object_id AND c.column_id = fc.parent_column_id
         WHERE fc.parent_object_id = OBJECT_ID(N'dbo.requests_general') AND c.name = N'id_origin_task') AS fk_origin_task;
