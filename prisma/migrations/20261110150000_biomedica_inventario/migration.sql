/*
  Migración: INGENIERÍA BIOMÉDICA · INVENTARIO DE EQUIPOS (fase 2, 2026-11-10; reunión de Nicolás Rivera con
  Juan Mora del 2026-11-10 y formato OLP-GCC-04-FR-017). Tablas en dbo, fuera del esquema sgc validado:
  equipos con su serie (única por empresa), estado (bodega, distribuido, faltante, dañado), artículo de SAP
  opcional y valor de cobro; valores unitarios por código interno; historial de solo inserción.

  SOLO ADITIVO e IDEMPOTENTE (tablas nuevas; no toca datos existentes). ⚠️ ANTES del código.

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/biomedica/__tests__/inventario.test.ts verifica que no se separen).
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.biomed_equipo', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[biomed_equipo] (
    [id_biomed_equipo] INT NOT NULL IDENTITY(1,1),
    [id_company] INT NOT NULL,
    [codigo_interno] NVARCHAR(50) NULL,
    [equipo] NVARCHAR(200) NOT NULL,
    [marca] NVARCHAR(100) NULL,
    [modelo] NVARCHAR(150) NULL,
    [serie] NVARCHAR(100) NOT NULL,
    [clasificacion_riesgo] NVARCHAR(20) NULL,
    [registro_sanitario] NVARCHAR(100) NULL,
    [cliente] NVARCHAR(200) NULL,
    [sede] NVARCHAR(200) NULL,
    [zona] NVARCHAR(100) NULL,
    [ciudad] NVARCHAR(100) NULL,
    [estado] NVARCHAR(20) NOT NULL CONSTRAINT [biomed_equipo_estado_df] DEFAULT N'bodega',
    [item_code_sap] NVARCHAR(50) NULL,
    [observacion] NVARCHAR(1000) NULL,
    [valor_cobro] DECIMAL(18,2) NULL,
    [novedad_at] DATETIME2 NULL,
    [created_by] NVARCHAR(255) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [biomed_equipo_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_by] NVARCHAR(255) NULL,
    [updated_at] DATETIME2 NULL,
    CONSTRAINT [biomed_equipo_pkey] PRIMARY KEY CLUSTERED ([id_biomed_equipo]),
    CONSTRAINT [biomed_equipo_id_company_serie_key] UNIQUE NONCLUSTERED ([id_company], [serie]),
    CONSTRAINT [biomed_equipo_estado_ck] CHECK ([estado] IN (N'bodega', N'distribuido', N'faltante', N'danado')),
    CONSTRAINT [biomed_equipo_valor_cobro_ck] CHECK ([valor_cobro] IS NULL OR [valor_cobro] >= 0)
  );
  CREATE NONCLUSTERED INDEX [biomed_equipo_id_company_estado_idx] ON [dbo].[biomed_equipo]([id_company], [estado]);
  CREATE NONCLUSTERED INDEX [biomed_equipo_id_company_codigo_interno_idx] ON [dbo].[biomed_equipo]([id_company], [codigo_interno]);
END;

IF OBJECT_ID(N'dbo.biomed_valor_unitario', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[biomed_valor_unitario] (
    [id_biomed_valor_unitario] INT NOT NULL IDENTITY(1,1),
    [id_company] INT NOT NULL,
    [codigo_interno] NVARCHAR(50) NOT NULL,
    [valor] DECIMAL(18,2) NOT NULL,
    [updated_by] NVARCHAR(255) NOT NULL,
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [biomed_valor_unitario_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [biomed_valor_unitario_pkey] PRIMARY KEY CLUSTERED ([id_biomed_valor_unitario]),
    CONSTRAINT [biomed_valor_unitario_id_company_codigo_interno_key] UNIQUE NONCLUSTERED ([id_company], [codigo_interno]),
    CONSTRAINT [biomed_valor_unitario_valor_ck] CHECK ([valor] >= 0)
  );
END;

IF OBJECT_ID(N'dbo.biomed_equipo_evento', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[biomed_equipo_evento] (
    [id_biomed_equipo_evento] INT NOT NULL IDENTITY(1,1),
    [id_company] INT NOT NULL,
    [id_biomed_equipo] INT NULL,
    [accion] NVARCHAR(40) NOT NULL,
    [antes] NVARCHAR(MAX) NULL,
    [despues] NVARCHAR(MAX) NULL,
    [justificacion] NVARCHAR(1000) NULL,
    [lote] NVARCHAR(40) NULL,
    [actor_email] NVARCHAR(255) NOT NULL,
    [ip] NVARCHAR(100) NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [biomed_equipo_evento_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [biomed_equipo_evento_pkey] PRIMARY KEY CLUSTERED ([id_biomed_equipo_evento])
  );
  CREATE NONCLUSTERED INDEX [biomed_equipo_evento_id_biomed_equipo_created_at_idx] ON [dbo].[biomed_equipo_evento]([id_biomed_equipo], [created_at]);
  CREATE NONCLUSTERED INDEX [biomed_equipo_evento_id_company_created_at_idx] ON [dbo].[biomed_equipo_evento]([id_company], [created_at]);
END;

-- El historial de los equipos es solo inserción (control de cambios).
IF OBJECT_ID(N'dbo.biomed_equipo_evento_solo_insercion', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [dbo].[biomed_equipo_evento_solo_insercion] ON [dbo].[biomed_equipo_evento] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51589, N''El historial de los equipos biomédicos no se cambia ni se borra.'', 1; END';

/* BLOQUE-DDL-FIN */
