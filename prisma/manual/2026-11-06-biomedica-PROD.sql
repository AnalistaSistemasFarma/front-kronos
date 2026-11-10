/*
  PASE MANUAL (PROD) — Ingeniería biomédica (2026-11-06).

  QUÉ HACE (idempotente; no toca datos existentes):
    1. el MISMO bloque DDL de prisma/migrations/20261106150000_biomedica/migration.sql
       (tablas biomed_formato, biomed_registro y biomed_evento con su disparador de solo inserción);
    2. el permiso «SGC · Ingeniería biomédica» (subproceso /process/sgc-documental/biomedica).

  ORDEN: ANTES del código. CÓMO CORRERLO: script Node con `mssql` o SSMS, con respaldo COPY_ONLY antes.
  REVERSA: prisma/manual/2026-11-06-biomedica-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51597, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.biomed_formato', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[biomed_formato] (
    [id_biomed_formato] INT NOT NULL IDENTITY(1,1),
    [id_company] INT NOT NULL,
    [id_document] INT NOT NULL,
    [actividad] NVARCHAR(200) NOT NULL,
    [is_active] BIT NOT NULL CONSTRAINT [biomed_formato_is_active_df] DEFAULT 1,
    [created_by] NVARCHAR(255) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [biomed_formato_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_by] NVARCHAR(255) NULL,
    [updated_at] DATETIME2 NULL,
    CONSTRAINT [biomed_formato_pkey] PRIMARY KEY CLUSTERED ([id_biomed_formato]),
    CONSTRAINT [biomed_formato_id_company_id_document_key] UNIQUE NONCLUSTERED ([id_company], [id_document])
  );
END;

IF OBJECT_ID(N'dbo.biomed_registro', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[biomed_registro] (
    [id_biomed_registro] INT NOT NULL IDENTITY(1,1),
    [id_company] INT NOT NULL,
    [id_biomed_formato] INT NOT NULL,
    [id_document] INT NOT NULL,
    [id_document_version] INT NOT NULL,
    [equipo] NVARCHAR(200) NOT NULL,
    [serial] NVARCHAR(100) NULL,
    [estado] NVARCHAR(20) NOT NULL CONSTRAINT [biomed_registro_estado_df] DEFAULT N'borrador',
    [data_json] NVARCHAR(MAX) NOT NULL CONSTRAINT [biomed_registro_data_json_df] DEFAULT N'[]',
    [created_by] NVARCHAR(255) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [biomed_registro_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_by] NVARCHAR(255) NULL,
    [updated_at] DATETIME2 NULL,
    [closed_by] NVARCHAR(255) NULL,
    [closed_at] DATETIME2 NULL,
    [annul_reason] NVARCHAR(1000) NULL,
    CONSTRAINT [biomed_registro_pkey] PRIMARY KEY CLUSTERED ([id_biomed_registro]),
    CONSTRAINT [biomed_registro_id_biomed_formato_fkey] FOREIGN KEY ([id_biomed_formato]) REFERENCES [dbo].[biomed_formato]([id_biomed_formato]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [biomed_registro_estado_ck] CHECK ([estado] IN (N'borrador', N'cerrado', N'anulado'))
  );
  CREATE NONCLUSTERED INDEX [biomed_registro_id_company_estado_idx] ON [dbo].[biomed_registro]([id_company], [estado]);
END;

IF OBJECT_ID(N'dbo.biomed_evento', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[biomed_evento] (
    [id_biomed_evento] INT NOT NULL IDENTITY(1,1),
    [id_company] INT NOT NULL,
    [id_biomed_registro] INT NULL,
    [accion] NVARCHAR(60) NOT NULL,
    [actor_email] NVARCHAR(255) NOT NULL,
    [detalle] NVARCHAR(2000) NULL,
    [ip] NVARCHAR(100) NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [biomed_evento_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [biomed_evento_pkey] PRIMARY KEY CLUSTERED ([id_biomed_evento])
  );
  CREATE NONCLUSTERED INDEX [biomed_evento_id_company_created_at_idx] ON [dbo].[biomed_evento]([id_company], [created_at]);
END;

-- La trazabilidad es solo inserción.
IF OBJECT_ID(N'dbo.biomed_evento_solo_insercion', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [dbo].[biomed_evento_solo_insercion] ON [dbo].[biomed_evento] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51599, N''La trazabilidad de Ingeniería biomédica no se cambia ni se borra.'', 1; END';

/* BLOQUE-DDL-FIN */

/* Permiso «SGC · Ingeniería biomédica» (subproceso del proceso del SGC; idempotente por URL). Lo asigna
   TI a los ingenieros biomédicos; Aseguramiento de Calidad del SGC también entra sin él. */
DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/sgc-documental' ORDER BY id_subprocess);
IF @ProcessId IS NULL
  THROW 51598, N'Falta el subproceso del SGC documental (/process/sgc-documental).', 1;
IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/sgc-documental/biomedica')
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (N'SGC · Ingeniería biomédica', @ProcessId, N'/process/sgc-documental/biomedica');

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.biomed_formato', N'U') AS biomed_formato,
       OBJECT_ID(N'dbo.biomed_registro', N'U') AS biomed_registro,
       OBJECT_ID(N'dbo.biomed_evento', N'U') AS biomed_evento,
       (SELECT COUNT(*) FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/sgc-documental/biomedica') AS permiso;
