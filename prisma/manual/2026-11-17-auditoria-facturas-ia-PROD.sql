/*
  PASE MANUAL (PRODUCCIÓN) — Auditoría de agentes → Facturas de IA (2026-11-17, pedido de Nicolás).
  QUÉ HACE (idempotente; solo crea lo que falta; tablas nuevas, sin tocar datos existentes):
    - dbo.ai_invoice        facturas de proveedores de IA: número, fechas, período, empresa que la PAGA, total y el PDF.
    - dbo.ai_invoice_line   líneas de cada factura (descripción, período, cantidad, precio, monto).
    - dbo.ai_invoice_split  reparto interno: cuánto le corresponde a cada empresa (por licencias o manual).
  Sin modelo Prisma (lib/agent-audit/facturas-db.ts). Riesgo de bloqueo: nulo (solo CREATE TABLE).
  REVERSA: …-auditoria-facturas-ia-reversa.sql
*/
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51722, N'Base no esperada para este script.', 1;
SET XACT_ABORT ON;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[ai_invoice]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ai_invoice] (
    [id_invoice]     INT IDENTITY(1,1) NOT NULL,
    [proveedor]      NVARCHAR(80)   NOT NULL,             -- Anthropic, OpenAI…
    [numero]         NVARCHAR(60)   NOT NULL,
    [fecha]          DATE           NOT NULL,             -- fecha de emisión
    [vence]          DATE           NULL,
    [periodo_desde]  DATE           NULL,
    [periodo_hasta]  DATE           NULL,
    [facturado_a]    NVARCHAR(200)  NULL,                 -- nombre que trae la factura
    [correo_cuenta]  NVARCHAR(200)  NULL,                 -- cuenta del proveedor (p. ej. automatizacion@…)
    [organizacion]   NVARCHAR(40)   NULL,                 -- organización de Anthropic (mismo texto que ai_license.organizacion)
    [id_company]     INT            NOT NULL,             -- empresa que la PAGA
    [moneda]         NVARCHAR(3)    NOT NULL CONSTRAINT [DF_aiinv_moneda] DEFAULT (N'USD'),
    [subtotal]       DECIMAL(14,2)  NULL,
    [impuestos]      DECIMAL(14,2)  NULL,
    [total]          DECIMAL(14,2)  NOT NULL,
    [estado]         NVARCHAR(20)   NOT NULL CONSTRAINT [DF_aiinv_estado] DEFAULT (N'pagada'),   -- pagada | pendiente
    [notas]          NVARCHAR(500)  NULL,
    [pdf]            VARBINARY(MAX) NULL,
    [pdf_nombre]     NVARCHAR(200)  NULL,
    [created_at]     DATETIME2(0)   NOT NULL CONSTRAINT [DF_aiinv_cre] DEFAULT (SYSUTCDATETIME()),
    [created_by]     NVARCHAR(200)  NULL,
    [updated_at]     DATETIME2(0)   NOT NULL CONSTRAINT [DF_aiinv_upd] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_ai_invoice] PRIMARY KEY ([id_invoice])
  );
  CREATE UNIQUE INDEX [UX_ai_invoice_numero] ON [dbo].[ai_invoice]([proveedor], [numero]);
  CREATE INDEX [IX_ai_invoice_fecha] ON [dbo].[ai_invoice]([fecha]);
END;
IF OBJECT_ID(N'[dbo].[ai_invoice_line]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ai_invoice_line] (
    [id_line]          INT IDENTITY(1,1) NOT NULL,
    [id_invoice]       INT            NOT NULL,
    [descripcion]      NVARCHAR(300)  NOT NULL,
    [periodo]          NVARCHAR(60)   NULL,
    [cantidad]         DECIMAL(10,2)  NULL,
    [precio_unitario]  DECIMAL(14,2)  NULL,
    [monto]            DECIMAL(14,2)  NOT NULL,
    CONSTRAINT [PK_ai_invoice_line] PRIMARY KEY ([id_line])
  );
  CREATE INDEX [IX_ai_invoice_line_inv] ON [dbo].[ai_invoice_line]([id_invoice]);
END;
IF OBJECT_ID(N'[dbo].[ai_invoice_split]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ai_invoice_split] (
    [id_invoice]  INT            NOT NULL,
    [id_company]  INT            NOT NULL,             -- empresa a la que le CORRESPONDE (cobro interno)
    [monto]       DECIMAL(14,2)  NOT NULL,
    [fuente]      NVARCHAR(20)   NOT NULL,             -- licencias | manual
    [updated_at]  DATETIME2(0)   NOT NULL CONSTRAINT [DF_aiis_upd] DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT [PK_ai_invoice_split] PRIMARY KEY ([id_invoice], [id_company])
  );
END;
COMMIT;
END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH;
