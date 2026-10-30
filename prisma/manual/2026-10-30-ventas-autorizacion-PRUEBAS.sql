/*
  PASE MANUAL (PRUEBAS) — Ventas: configuración por empresa y autorización en SynerLink. 2026-10-30.
  BASE: KRONOSDB_PRUEBAS o kronos_ci (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo crea, no borra ni modifica datos existentes):
    1. dbo.sales_company_config: reglas por empresa (OLP solo cupo: valida_precio = 0) y las dos
       plantillas del workflow (precios y extracupo). NO inserta filas: se configuran después.
    2. dbo.sales_stage_department: departamento(s) autorizador(es) de cada etapa por empresa
       (precios, comercial, administrativa). Decisión de Nicolás Rivera: autorización por
       departamento, como Compras. Sin filas para una etapa = departamento del solicitante.
    3. dbo.sales_authorization: enlace borrador SAP (empresa + DocEntry) <-> requests_general.
       Índice único filtrado: una sola autorización viva por borrador.
    4. Subprocesos-permiso bajo el proceso «Ventas» (el mismo de /process/sells):
       /process/sales «Ventas · Ofertas», /process/sales/manage «Ventas · Gestionar ofertas»,
       /process/sales/automatizacion «Ventas · Automatización (administración)».
       No los otorga a nadie: se asignan desde Administración → Usuarios.

  Lo usa SOLO el módulo de ventas (lib/sales). No toca SAP.
  REVERSA: prisma/manual/2026-10-30-ventas-autorizacion-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51480, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[subprocess]
  WHERE LOWER(LTRIM(RTRIM(subprocess_url))) = N'/process/sells/salesoffers' ORDER BY id_subprocess
);
IF @ProcessId IS NULL
  THROW 51481, N'No existe el proceso «Ventas» (subproceso /process/sells/salesoffers): revise la base.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.sales_company_config', N'U') IS NULL
    CREATE TABLE [dbo].[sales_company_config] (
      [id_company]                  INT            NOT NULL,
      [activo]                      BIT            NOT NULL CONSTRAINT [sales_company_config_activo_df] DEFAULT 0,
      [valida_precio]               BIT            NOT NULL CONSTRAINT [sales_company_config_valida_precio_df] DEFAULT 1,
      [precio_solo_si_menor]        BIT            NOT NULL CONSTRAINT [sales_company_config_solo_menor_df] DEFAULT 0,
      [tolerancia_precio]           DECIMAL(19,6)  NOT NULL CONSTRAINT [sales_company_config_tol_precio_df] DEFAULT 0,
      [pct_tolerancia_cupo]         DECIMAL(9,4)   NOT NULL CONSTRAINT [sales_company_config_pct_cupo_df] DEFAULT 20,
      [estados_suma_cupo]           NVARCHAR(50)   NOT NULL CONSTRAINT [sales_company_config_estados_df] DEFAULT N'AE,AEDA',
      [id_process_category_precios] INT            NULL,
      [id_process_category_cupo]    INT            NULL,
      [ventas_emails]               NVARCHAR(500)  NULL,
      [default_currency]            NVARCHAR(3)    NULL,
      [default_warehouse]           NVARCHAR(8)    NULL,
      CONSTRAINT [sales_company_config_pkey] PRIMARY KEY CLUSTERED ([id_company])
    );

  IF OBJECT_ID(N'dbo.sales_stage_department', N'U') IS NULL
    CREATE TABLE [dbo].[sales_stage_department] (
      [id]            INT IDENTITY(1,1) NOT NULL,
      [id_company]    INT            NOT NULL,
      [etapa]         NVARCHAR(20)   NOT NULL,
      [id_department] INT            NOT NULL,
      CONSTRAINT [sales_stage_department_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [sales_stage_department_key] UNIQUE ([id_company], [etapa], [id_department]),
      CONSTRAINT [CK_sales_stage_department_etapa] CHECK ([etapa] IN (N'precios', N'comercial', N'administrativa'))
    );

  IF OBJECT_ID(N'dbo.sales_authorization', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[sales_authorization] (
      [id]                     INT IDENTITY(1,1) NOT NULL,
      [id_company]             INT            NOT NULL,
      [doc_entry]              INT            NOT NULL,
      [id_request_general]     INT            NOT NULL,
      [etapa]                  NVARCHAR(20)   NOT NULL CONSTRAINT [sales_authorization_etapa_df] DEFAULT N'oferta',
      [id_authorization_previa] INT           NULL,
      [status]                 NVARCHAR(20)   NOT NULL,
      [evaluacion]             NVARCHAR(MAX)  NULL,
      [order_doc_entry]        INT            NULL,
      [error]                  NVARCHAR(500)  NULL,
      [created_by]             NVARCHAR(50)   NOT NULL,
      [created_at]             DATETIME2      NOT NULL CONSTRAINT [sales_authorization_created_at_df] DEFAULT sysutcdatetime(),
      [updated_at]             DATETIME2      NOT NULL CONSTRAINT [sales_authorization_updated_at_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [sales_authorization_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [sales_authorization_id_request_general_key] UNIQUE ([id_request_general]),
      CONSTRAINT [CK_sales_authorization_etapa] CHECK ([etapa] IN (N'oferta', N'precios', N'extracupo')),
      CONSTRAINT [CK_sales_authorization_status] CHECK ([status] IN
        (N'pending', N'publishing', N'approved', N'rejected', N'cancelled', N'publish_error', N'reject_error'))
    );
  END

  /* v2 (flujo diagramado, una solicitud por oferta): la etapa admite «oferta». */
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_sales_authorization_etapa'
             AND definition NOT LIKE N'%oferta%')
  BEGIN
    ALTER TABLE [dbo].[sales_authorization] DROP CONSTRAINT [CK_sales_authorization_etapa];
    ALTER TABLE [dbo].[sales_authorization] ADD CONSTRAINT [CK_sales_authorization_etapa]
      CHECK ([etapa] IN (N'oferta', N'precios', N'extracupo'));
  END
  IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'sales_authorization_etapa_df')
    ALTER TABLE [dbo].[sales_authorization] ADD CONSTRAINT [sales_authorization_etapa_df] DEFAULT N'oferta' FOR [etapa];

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sales_authorization_id_company_doc_entry_idx')
    CREATE NONCLUSTERED INDEX [sales_authorization_id_company_doc_entry_idx]
      ON [dbo].[sales_authorization]([id_company], [doc_entry]);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_sales_authorization_viva')
    CREATE UNIQUE NONCLUSTERED INDEX [UX_sales_authorization_viva]
      ON [dbo].[sales_authorization]([id_company], [doc_entry])
      WHERE [status] IN (N'pending', N'publishing', N'publish_error');

  IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/sales')
    INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (N'Ventas · Ofertas', @ProcessId, N'/process/sales');
  IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/sales/manage')
    INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (N'Ventas · Gestionar ofertas', @ProcessId, N'/process/sales/manage');
  IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/sales/automatizacion')
    INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (N'Ventas · Automatización (administración)', @ProcessId, N'/process/sales/automatizacion');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Diagnóstico */
SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.sales_company_config', N'U') AS tabla_config,
       OBJECT_ID(N'dbo.sales_stage_department', N'U') AS tabla_departamentos,
       OBJECT_ID(N'dbo.sales_authorization', N'U') AS tabla_autorizacion,
       (SELECT COUNT(*) FROM [dbo].[subprocess] WHERE subprocess_url LIKE N'/process/sales%') AS subprocesos_ventas;

/*
  CONFIGURACIÓN POR EMPRESA (después de crear en el workflow las plantillas
  «Venta · Autorización de precios» y «Venta · Autorización de extracupo»):
    INSERT INTO dbo.sales_company_config (id_company, activo, valida_precio, id_process_category_precios, id_process_category_cupo, ventas_emails, default_currency)
    VALUES (3, 1, 0, NULL, <extracupo>, N'<correos>', N'COP');   -- OLP: solo cupo
    INSERT INTO dbo.sales_stage_department (id_company, etapa, id_department) VALUES (<empresa>, N'administrativa', <id ADMINISTRACIÓN>);
*/
