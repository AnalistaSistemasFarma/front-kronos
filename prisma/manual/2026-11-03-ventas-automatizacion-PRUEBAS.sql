/*
  PASE MANUAL (PRUEBAS) — Ventas: automatización de borradores de Salesforce (panel estilo Nabuco). 2026-11-03.
  BASE: KRONOSDB_PRUEBAS o kronos_ci (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo crea, no borra ni modifica datos existentes):
    1. dbo.sales_automation_config: una configuración por empresa (activa, simulación, usuario SAP
       que crea los borradores, desde qué fecha, solicitante en SynerLink, tarea del programador, lock).
    2. dbo.sales_automation_doc: registro por borrador (simulado, enviado, error, descartado).
       Índice único (empresa, borrador): un borrador nunca se pasa dos veces al flujo.
    3. dbo.sales_automation_run: historial de corridas (programada, manual, asistida).
  La tarea del programador central (scheduled_job «ventas_automatizar») la crea la pantalla al guardar.
  REVERSA: prisma/manual/2026-11-03-ventas-automatizacion-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51500, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS o kronos_ci.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.sales_automation_config', N'U') IS NULL
    CREATE TABLE [dbo].[sales_automation_config] (
      [id_company]          INT           NOT NULL,
      [activo]              BIT           NOT NULL CONSTRAINT [sales_automation_config_activo_df] DEFAULT 0,
      [simulacion]          BIT           NOT NULL CONSTRAINT [sales_automation_config_simulacion_df] DEFAULT 1,
      [intervalo_min]       INT           NOT NULL CONSTRAINT [sales_automation_config_intervalo_df] DEFAULT 10,
      [user_sign]           NVARCHAR(100) NULL,  -- UserSign separados por coma, p. ej. «14,30»
      [desde_fecha]         DATE          NULL,
      [id_user_solicitante] NVARCHAR(50)  NULL,
      [id_job]              INT           NULL,
      [en_ejecucion_desde]  DATETIME2     NULL,
      [updated_by]          NVARCHAR(50)  NULL,
      [updated_at]          DATETIME2     NOT NULL CONSTRAINT [sales_automation_config_updated_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [sales_automation_config_pkey] PRIMARY KEY CLUSTERED ([id_company]),
      CONSTRAINT [CK_sales_automation_config_intervalo] CHECK ([intervalo_min] BETWEEN 5 AND 1440)
    );

  IF OBJECT_ID(N'dbo.sales_automation_doc', N'U') IS NULL
    CREATE TABLE [dbo].[sales_automation_doc] (
      [id]                 INT IDENTITY(1,1) NOT NULL,
      [id_company]         INT            NOT NULL,
      [doc_entry]          INT            NOT NULL,
      [doc_num]            INT            NULL,
      [card_code]          NVARCHAR(50)   NULL,
      [card_name]          NVARCHAR(200)  NULL,
      [doc_total]          DECIMAL(19,6)  NULL,
      [estado]             NVARCHAR(20)   NOT NULL,
      [destino]            NVARCHAR(20)   NULL,
      [detalle]            NVARCHAR(1000) NULL,
      [error]              NVARCHAR(1000) NULL,
      [id_request_general] INT            NULL,
      [intentos]           INT            NOT NULL CONSTRAINT [sales_automation_doc_intentos_df] DEFAULT 0,
      [usuario_accion]     NVARCHAR(50)   NULL,
      [created_at]         DATETIME2      NOT NULL CONSTRAINT [sales_automation_doc_created_df] DEFAULT sysutcdatetime(),
      [updated_at]         DATETIME2      NOT NULL CONSTRAINT [sales_automation_doc_updated_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [sales_automation_doc_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [sales_automation_doc_key] UNIQUE ([id_company], [doc_entry]),
      CONSTRAINT [CK_sales_automation_doc_estado] CHECK ([estado] IN (N'simulado', N'enviado', N'error', N'descartado'))
    );

  IF OBJECT_ID(N'dbo.sales_automation_run', N'U') IS NULL
    CREATE TABLE [dbo].[sales_automation_run] (
      [id]          INT IDENTITY(1,1) NOT NULL,
      [id_company]  INT            NOT NULL,
      [origen]      NVARCHAR(20)   NOT NULL,
      [usuario]     NVARCHAR(50)   NULL,
      [inicio]      DATETIME2      NOT NULL CONSTRAINT [sales_automation_run_inicio_df] DEFAULT sysutcdatetime(),
      [fin]         DATETIME2      NULL,
      [simulacion]  BIT            NOT NULL CONSTRAINT [sales_automation_run_sim_df] DEFAULT 1,
      [candidatos]  INT            NOT NULL CONSTRAINT [sales_automation_run_cand_df] DEFAULT 0,
      [enviados]    INT            NOT NULL CONSTRAINT [sales_automation_run_env_df] DEFAULT 0,
      [simulados]   INT            NOT NULL CONSTRAINT [sales_automation_run_simu_df] DEFAULT 0,
      [errores]     INT            NOT NULL CONSTRAINT [sales_automation_run_err_df] DEFAULT 0,
      [detalle]     NVARCHAR(1000) NULL,
      CONSTRAINT [sales_automation_run_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [CK_sales_automation_run_origen] CHECK ([origen] IN (N'programada', N'manual', N'asistida'))
    );
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sales_automation_run_company_idx')
    CREATE NONCLUSTERED INDEX [sales_automation_run_company_idx] ON [dbo].[sales_automation_run]([id_company], [inicio] DESC);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.sales_automation_config', N'U') AS tabla_config,
       OBJECT_ID(N'dbo.sales_automation_doc', N'U') AS tabla_docs,
       OBJECT_ID(N'dbo.sales_automation_run', N'U') AS tabla_corridas;
