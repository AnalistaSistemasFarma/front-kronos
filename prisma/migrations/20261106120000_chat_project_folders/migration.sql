/*
  Migración: CARPETAS en los Archivos del proyecto (2026-11-06).
  Reunión de Nicolás Rivera con Juan Mora (2026-11-05): repositorio de documentación regulatoria
  (autorizaciones del INVIMA, fichas técnicas, artes) organizado por carpetas, con carga de
  carpetas completas.

  SOLO ADITIVO e IDEMPOTENTE, se puede aplicar en caliente:
    - chat_project_file.folder_path NVARCHAR(400) NULL (NULL = la raíz) + índice (id_project, folder_path);
    - tabla chat_project_folder (ruta única por proyecto; cae en cascada con el proyecto).
  No toca ni copia datos existentes: los archivos actuales quedan en la raíz.

  ⚠️ ORDEN: ANTES del código. El código nuevo lee folder_path y chat_project_folder al pintar el proyecto.

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/proyectos/__tests__/carpetas.test.ts verifica que no se separen).
*/

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
