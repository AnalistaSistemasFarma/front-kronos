/*
  PASE MANUAL (PRUEBAS) — Carpetas en los Archivos del proyecto (2026-11-06).

  QUÉ HACE (idempotente; solo agrega lo que falta, no toca ni copia datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261106120000_chat_project_folders/migration.sql:
    columna NULL chat_project_file.folder_path + índice, y la tabla chat_project_folder.

  ORDEN: ANTES del código. El código nuevo lee estas columnas al pintar la pestaña Archivos; sin
  ellas el detalle del proyecto falla.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS,
  con respaldo COPY_ONLY antes. REVERSA: prisma/manual/2026-11-06-chat-project-carpetas-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51581, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.chat_project_file', N'U') IS NULL
  THROW 51580, N'Falta la tabla chat_project_file (módulo de Proyectos).', 1;

IF COL_LENGTH(N'dbo.chat_project_file', N'folder_path') IS NULL
  ALTER TABLE [dbo].[chat_project_file] ADD [folder_path] NVARCHAR(400) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'chat_project_file_id_project_folder_path_idx' AND object_id = OBJECT_ID(N'dbo.chat_project_file'))
  EXEC sp_executesql N'CREATE NONCLUSTERED INDEX [chat_project_file_id_project_folder_path_idx] ON [dbo].[chat_project_file]([id_project], [folder_path]);';

IF OBJECT_ID(N'dbo.chat_project_folder', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_folder] (
    [id_project_folder] INT NOT NULL IDENTITY(1,1),
    [id_project] INT NOT NULL,
    [path] NVARCHAR(400) NOT NULL,
    [created_by] NVARCHAR(1000) NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [chat_project_folder_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_folder_pkey] PRIMARY KEY CLUSTERED ([id_project_folder]),
    CONSTRAINT [chat_project_folder_id_project_path_key] UNIQUE NONCLUSTERED ([id_project], [path]),
    CONSTRAINT [chat_project_folder_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base,
       COL_LENGTH(N'dbo.chat_project_file', N'folder_path') AS folder_path,
       OBJECT_ID(N'dbo.chat_project_folder', N'U') AS chat_project_folder;
