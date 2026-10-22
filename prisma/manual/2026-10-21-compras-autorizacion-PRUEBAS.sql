/*
  PASE MANUAL (PRUEBAS) — Compras: autorización de solicitudes en SynerLink. 2026-10-21.
  BASE: KRONOSDB_PRUEBAS o kronos_ci (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo crea, no borra ni modifica datos existentes):
    1. dbo.purchase_authorization: enlace borrador SAP (empresa + DocEntry) <-> requests_general.
       Índice único filtrado: una sola autorización viva por borrador.
    2. dbo.purchase_company_config: plantilla del workflow (process_category) por empresa.
       NO inserta filas: configure cada empresa después (ver al final).

  Lo usa SOLO el módulo de compras (lib/purchases/authorization.ts).
  REVERSA: prisma/manual/2026-10-21-compras-autorizacion-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51470, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS o kronos_ci.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.purchase_authorization', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[purchase_authorization] (
      [id]                 INT IDENTITY(1,1) NOT NULL,
      [id_company]         INT            NOT NULL,
      [doc_entry]          INT            NOT NULL,
      [id_request_general] INT            NOT NULL,
      [status]             NVARCHAR(20)   NOT NULL,
      [firm_doc_entry]     INT            NULL,
      [error]              NVARCHAR(500)  NULL,
      [created_by]         NVARCHAR(50)   NOT NULL,
      [created_at]         DATETIME2      NOT NULL CONSTRAINT [purchase_authorization_created_at_df] DEFAULT sysutcdatetime(),
      [updated_at]         DATETIME2      NOT NULL CONSTRAINT [purchase_authorization_updated_at_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [purchase_authorization_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [purchase_authorization_id_request_general_key] UNIQUE ([id_request_general]),
      CONSTRAINT [CK_purchase_authorization_status] CHECK ([status] IN
        (N'pending', N'publishing', N'approved', N'rejected', N'quoted', N'cancelled', N'publish_error', N'reject_error'))
    );
  END

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'purchase_authorization_id_company_doc_entry_idx')
    CREATE NONCLUSTERED INDEX [purchase_authorization_id_company_doc_entry_idx]
      ON [dbo].[purchase_authorization]([id_company], [doc_entry]);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_purchase_authorization_viva')
    CREATE UNIQUE NONCLUSTERED INDEX [UX_purchase_authorization_viva]
      ON [dbo].[purchase_authorization]([id_company], [doc_entry])
      WHERE [status] IN (N'pending', N'publishing', N'publish_error');

  IF OBJECT_ID(N'dbo.purchase_company_config', N'U') IS NULL
    CREATE TABLE [dbo].[purchase_company_config] (
      [id_company]               INT NOT NULL,
      [id_process_category_auth] INT NOT NULL,
      [compras_emails]           NVARCHAR(500) NULL,
      [default_currency]         NVARCHAR(3)   NULL,
      [default_warehouse]        NVARCHAR(8)   NULL,
      CONSTRAINT [purchase_company_config_pkey] PRIMARY KEY CLUSTERED ([id_company])
    );

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Diagnóstico */
SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.purchase_authorization', N'U') AS tabla_autorizacion,
       OBJECT_ID(N'dbo.purchase_company_config', N'U') AS tabla_config;

/*
  CONFIGURACIÓN POR EMPRESA (después de crear en el workflow la plantilla «Solicitud de compra»
  con UNA tarea de autorización, tipo de autorización por departamento):
    INSERT INTO dbo.purchase_company_config (id_company, id_process_category_auth, compras_emails, default_currency, default_warehouse)
    VALUES (<empresa>, <process_category>, N'<correo1>,<correo2>', N'COP', NULL);   -- Ryan: moneda NULL y bodega N'MPR01'
*/
