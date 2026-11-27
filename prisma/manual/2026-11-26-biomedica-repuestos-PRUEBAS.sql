/*
  PASE MANUAL (PRUEBAS) — Ingeniería biomédica · repuestos e insumos (2026-11-26).
  QUÉ HACE (idempotente; no toca datos existentes): el MISMO bloque DDL de
  prisma/migrations/20261126190000_biomedica_repuestos/migration.sql. Usa el permiso del módulo de Ingeniería biomédica.
  ORDEN: ANTES del código. CÓMO CORRERLO: script Node con `mssql` o SSMS, con respaldo COPY_ONLY antes.
  REVERSA: prisma/manual/2026-11-26-biomedica-repuestos-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51597, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

SET XACT_ABORT ON;

-- Repuestos e insumos de Ingeniería biomédica (inventario APARTE del de equipos y dispositivos).
IF OBJECT_ID(N'dbo.biomed_repuesto', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[biomed_repuesto] (
    [id_biomed_repuesto] INT NOT NULL IDENTITY(1,1),
    [id_company] INT NOT NULL,
    [tipo] NVARCHAR(20) NOT NULL,
    [codigo] NVARCHAR(50) NULL,
    [nombre] NVARCHAR(200) NOT NULL,
    [unidad] NVARCHAR(30) NOT NULL CONSTRAINT [biomed_repuesto_unidad_df] DEFAULT N'unidad',
    [modelo_compatible] NVARCHAR(150) NULL,
    [ubicacion] NVARCHAR(100) NULL,
    [stock] DECIMAL(18,2) NOT NULL CONSTRAINT [biomed_repuesto_stock_df] DEFAULT 0,
    [stock_minimo] DECIMAL(18,2) NULL,
    [item_code_sap] NVARCHAR(50) NULL,
    [activo] BIT NOT NULL CONSTRAINT [biomed_repuesto_activo_df] DEFAULT 1,
    [created_by] NVARCHAR(255) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [biomed_repuesto_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_by] NVARCHAR(255) NULL,
    [updated_at] DATETIME2 NULL,
    CONSTRAINT [biomed_repuesto_pkey] PRIMARY KEY CLUSTERED ([id_biomed_repuesto]),
    CONSTRAINT [biomed_repuesto_tipo_ck] CHECK ([tipo] IN (N'repuesto', N'insumo')),
    CONSTRAINT [biomed_repuesto_stock_ck] CHECK ([stock] >= 0 AND ([stock_minimo] IS NULL OR [stock_minimo] >= 0))
  );
  CREATE NONCLUSTERED INDEX [biomed_repuesto_id_company_tipo_idx] ON [dbo].[biomed_repuesto]([id_company], [tipo]);
END;

-- Movimientos (entrada, salida, ajuste): solo inserción. Una salida puede quedar ligada al equipo donde se usó.
IF OBJECT_ID(N'dbo.biomed_repuesto_mov', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[biomed_repuesto_mov] (
    [id_biomed_repuesto_mov] INT NOT NULL IDENTITY(1,1),
    [id_company] INT NOT NULL,
    [id_biomed_repuesto] INT NOT NULL,
    [tipo] NVARCHAR(20) NOT NULL,
    [cantidad] DECIMAL(18,2) NOT NULL,
    [stock_resultante] DECIMAL(18,2) NOT NULL,
    [id_biomed_equipo] INT NULL,
    [referencia] NVARCHAR(100) NULL,
    [observacion] NVARCHAR(1000) NULL,
    [actor_email] NVARCHAR(255) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [biomed_repuesto_mov_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [biomed_repuesto_mov_pkey] PRIMARY KEY CLUSTERED ([id_biomed_repuesto_mov]),
    CONSTRAINT [biomed_repuesto_mov_tipo_ck] CHECK ([tipo] IN (N'entrada', N'salida', N'ajuste'))
  );
  CREATE NONCLUSTERED INDEX [biomed_repuesto_mov_repuesto_idx] ON [dbo].[biomed_repuesto_mov]([id_biomed_repuesto], [created_at]);
  CREATE NONCLUSTERED INDEX [biomed_repuesto_mov_equipo_idx] ON [dbo].[biomed_repuesto_mov]([id_biomed_equipo]);
END;

IF OBJECT_ID(N'dbo.biomed_repuesto_mov_solo_insercion', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [dbo].[biomed_repuesto_mov_solo_insercion] ON [dbo].[biomed_repuesto_mov] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51596, N''Los movimientos de repuestos e insumos no se cambian ni se borran.'', 1; END';

/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.biomed_repuesto', N'U') AS biomed_repuesto, OBJECT_ID(N'dbo.biomed_repuesto_mov', N'U') AS biomed_repuesto_mov, OBJECT_ID(N'dbo.biomed_repuesto_mov_solo_insercion', N'TR') AS disparador;
