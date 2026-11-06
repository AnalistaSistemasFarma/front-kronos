/*
  REVERSA — Carpetas en los Archivos del proyecto (2026-11-06). Deshace
  prisma/migrations/20261106120000_chat_project_folders y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): quita la tabla chat_project_folder, el índice y la columna
  chat_project_file.folder_path. Los ARCHIVOS no se pierden (siguen en la tabla y en OneDrive): todos
  vuelven a verse en la raíz; se pierde solo la organización por carpetas. Si hay archivos en carpetas
  o carpetas creadas, se niega salvo con la bandera de sesión:
    EXEC sp_set_session_context N'proyectos_carpetas_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51583, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @enCarpeta INT = 0;
DECLARE @carpetas INT = 0;
IF COL_LENGTH(N'dbo.chat_project_file', N'folder_path') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[chat_project_file] WHERE folder_path IS NOT NULL', N'@n INT OUTPUT', @n = @enCarpeta OUTPUT;
IF OBJECT_ID(N'dbo.chat_project_folder', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[chat_project_folder]', N'@n INT OUTPUT', @n = @carpetas OUTPUT;
SELECT DB_NAME() AS base, 'antes' AS momento, @enCarpeta AS archivos_en_carpeta, @carpetas AS carpetas;

IF (@enCarpeta > 0 OR @carpetas > 0)
   AND ISNULL(CAST(SESSION_CONTEXT(N'proyectos_carpetas_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51584, N'Hay archivos en carpetas o carpetas creadas: use la bandera proyectos_carpetas_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.chat_project_folder', N'U') IS NOT NULL
    DROP TABLE [dbo].[chat_project_folder];
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'chat_project_file_id_project_folder_path_idx' AND object_id = OBJECT_ID(N'dbo.chat_project_file'))
    DROP INDEX [chat_project_file_id_project_folder_path_idx] ON [dbo].[chat_project_file];
  IF COL_LENGTH(N'dbo.chat_project_file', N'folder_path') IS NOT NULL
    ALTER TABLE [dbo].[chat_project_file] DROP COLUMN [folder_path];
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento,
       COL_LENGTH(N'dbo.chat_project_file', N'folder_path') AS folder_path,
       OBJECT_ID(N'dbo.chat_project_folder', N'U') AS chat_project_folder;
