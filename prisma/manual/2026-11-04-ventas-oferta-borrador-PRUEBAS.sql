/*
  PASE MANUAL (PRUEBAS) — Ventas: ofertas guardadas en borrador (interruptor «Enviar a autorización»). 2026-11-04.
  BASE: KRONOSDB_PRUEBAS o kronos_ci (el script se detiene en cualquier otra base).
  QUÉ HACE (idempotente; solo crea): dbo.sales_offer_draft, una fila por oferta creada en SynerLink sin
  enviarla al flujo (borrador en SAP), con su estado (borrador, enviado, anulado). La automatización de
  Salesforce no toma estos borradores.
  REVERSA: prisma/manual/2026-11-04-ventas-oferta-borrador-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51520, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS o kronos_ci.', 1;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.sales_offer_draft', N'U') IS NULL
    CREATE TABLE [dbo].[sales_offer_draft] (
      [id]                  INT IDENTITY(1,1) NOT NULL,
      [id_company]          INT           NOT NULL,
      [doc_entry]           INT           NOT NULL,
      [quotation_doc_entry] INT           NULL,
      [id_user]             NVARCHAR(50)  NOT NULL,
      [status]              NVARCHAR(20)  NOT NULL,
      [id_request_general]  INT           NULL,
      [created_at]          DATETIME2     NOT NULL CONSTRAINT [sales_offer_draft_created_df] DEFAULT sysutcdatetime(),
      [updated_at]          DATETIME2     NOT NULL CONSTRAINT [sales_offer_draft_updated_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [sales_offer_draft_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [sales_offer_draft_key] UNIQUE ([id_company], [doc_entry]),
      CONSTRAINT [CK_sales_offer_draft_status] CHECK ([status] IN (N'borrador', N'enviado', N'anulado'))
    );
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sales_offer_draft_user_idx')
    CREATE NONCLUSTERED INDEX [sales_offer_draft_user_idx] ON [dbo].[sales_offer_draft]([id_user], [id_company], [status]);
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.sales_offer_draft', N'U') AS tabla;
