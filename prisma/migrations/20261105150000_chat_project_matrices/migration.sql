/*
  Proyectos — MATRICES integradas (2026-11-05). Diseño: docs/proyectos-matrices-dashboards.md.
  Idempotente; solo crea lo que falta.
    - chat_project_matrix          una matriz del proyecto (nombre, versión vigente)
    - chat_project_matrix_version  cada Excel/CSV subido (historial)
    - chat_project_matrix_sheet    hojas de una versión: columnas con tipo y número de filas
    - chat_project_matrix_chunk    filas de una hoja en bloques JSON (máx. 1000 filas por bloque)
*/
SET XACT_ABORT ON;
BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_project_matrix]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_matrix] (
    [id_matrix]       INT            IDENTITY(1,1) NOT NULL,
    [id_project]      INT            NOT NULL,
    [name]            NVARCHAR(150)  NOT NULL,
    [description]     NVARCHAR(1000) NULL,
    [id_version_actual] INT          NULL,
    [archived]        BIT            NOT NULL CONSTRAINT [chat_project_matrix_archived_df] DEFAULT 0,
    [created_by]      NVARCHAR(1000) NULL,
    [created_at]      DATETIME2      NOT NULL CONSTRAINT [chat_project_matrix_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at]      DATETIME2      NOT NULL CONSTRAINT [chat_project_matrix_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_matrix_pkey] PRIMARY KEY CLUSTERED ([id_matrix]),
    CONSTRAINT [chat_project_matrix_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_matrix_project_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_matrix]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_matrix_project_idx] ON [dbo].[chat_project_matrix]([id_project], [archived]);');

IF OBJECT_ID(N'[dbo].[chat_project_matrix_version]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_matrix_version] (
    [id_version]      INT            IDENTITY(1,1) NOT NULL,
    [id_matrix]       INT            NOT NULL,
    [version_no]      INT            NOT NULL,
    [file_name]       NVARCHAR(400)  NOT NULL,
    [size_bytes]      INT            NULL,
    [uploaded_by]     NVARCHAR(1000) NULL,
    [id_agent]        INT            NULL,
    [summary]         NVARCHAR(1000) NULL,
    [created_at]      DATETIME2      NOT NULL CONSTRAINT [chat_project_matrix_version_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_matrix_version_pkey] PRIMARY KEY CLUSTERED ([id_version]),
    CONSTRAINT [chat_project_matrix_version_no_key] UNIQUE NONCLUSTERED ([id_matrix], [version_no]),
    CONSTRAINT [chat_project_matrix_version_matrix_fkey] FOREIGN KEY ([id_matrix]) REFERENCES [dbo].[chat_project_matrix]([id_matrix]) ON DELETE CASCADE ON UPDATE NO ACTION
  );
END;

IF OBJECT_ID(N'[dbo].[chat_project_matrix_sheet]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_matrix_sheet] (
    [id_sheet]        INT            IDENTITY(1,1) NOT NULL,
    [id_version]      INT            NOT NULL,
    [sheet_index]     INT            NOT NULL,
    [name]            NVARCHAR(150)  NOT NULL,
    [header_row]      INT            NOT NULL,
    [columns_json]    NVARCHAR(MAX)  NOT NULL,
    [row_count]       INT            NOT NULL,
    CONSTRAINT [chat_project_matrix_sheet_pkey] PRIMARY KEY CLUSTERED ([id_sheet]),
    CONSTRAINT [chat_project_matrix_sheet_version_key] UNIQUE NONCLUSTERED ([id_version], [sheet_index]),
    CONSTRAINT [chat_project_matrix_sheet_version_fkey] FOREIGN KEY ([id_version]) REFERENCES [dbo].[chat_project_matrix_version]([id_version]) ON DELETE CASCADE ON UPDATE NO ACTION
  );
END;

IF OBJECT_ID(N'[dbo].[chat_project_matrix_chunk]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_matrix_chunk] (
    [id_sheet]        INT            NOT NULL,
    [chunk_no]        INT            NOT NULL,
    [rows_json]       NVARCHAR(MAX)  NOT NULL,
    CONSTRAINT [chat_project_matrix_chunk_pkey] PRIMARY KEY CLUSTERED ([id_sheet], [chunk_no]),
    CONSTRAINT [chat_project_matrix_chunk_sheet_fkey] FOREIGN KEY ([id_sheet]) REFERENCES [dbo].[chat_project_matrix_sheet]([id_sheet]) ON DELETE CASCADE ON UPDATE NO ACTION
  );
END;

COMMIT TRAN;
