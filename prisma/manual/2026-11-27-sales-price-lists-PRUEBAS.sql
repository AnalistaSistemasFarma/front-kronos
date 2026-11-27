-- Sales · customer price list updates (PRUEBAS). 2026-11-27.
-- Requested by Nicolás Rivera after the Farmalógica meeting: prices renegotiated with each customer are requested in
-- SynerLink, approved, and a SAP task writes them to SAP (the customer's own price list, or a special price when the
-- list is shared). Additive and idempotent. Rollback: 2026-11-27-sales-price-lists-rollback.sql
SET XACT_ABORT ON; SET NOCOUNT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51700, N'Unexpected database: this script is for KRONOSDB_PRUEBAS.', 1;
BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.price_update', N'U') IS NULL
    CREATE TABLE dbo.price_update (
      id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT price_update_pkey PRIMARY KEY,
      id_company          INT            NOT NULL,
      id_request_general  INT            NULL,
      card_code           NVARCHAR(50)   NOT NULL,
      card_name           NVARCHAR(200)  NULL,
      price_list_num      INT            NULL,
      price_list_name     NVARCHAR(100)  NULL,
      -- Other customers use the same list: a SPECIAL price is created for this customer only.
      shared_list         BIT            NOT NULL CONSTRAINT price_update_shared_list_df DEFAULT 0,
      status              NVARCHAR(20)   NOT NULL,
      comment             NVARCHAR(500)  NULL,
      error               NVARCHAR(1000) NULL,
      created_by          NVARCHAR(50)   NOT NULL,
      created_at          DATETIME2      NOT NULL CONSTRAINT price_update_created_df DEFAULT sysutcdatetime(),
      applied_at          DATETIME2      NULL,
      CONSTRAINT CK_price_update_status CHECK (status IN (N'pending', N'applying', N'applied', N'partial', N'error', N'rejected', N'cancelled'))
    );
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_price_update_request')
    CREATE UNIQUE NONCLUSTERED INDEX UX_price_update_request ON dbo.price_update(id_request_general) WHERE id_request_general IS NOT NULL;
  IF OBJECT_ID(N'dbo.price_update_line', N'U') IS NULL
    CREATE TABLE dbo.price_update_line (
      id                INT IDENTITY(1,1) NOT NULL CONSTRAINT price_update_line_pkey PRIMARY KEY,
      id_price_update   INT            NOT NULL CONSTRAINT price_update_line_fk REFERENCES dbo.price_update(id),
      line_num          INT            NOT NULL,
      item_code         NVARCHAR(50)   NOT NULL,
      item_name         NVARCHAR(200)  NULL,
      current_price     DECIMAL(19,6)  NULL,
      new_price         DECIMAL(19,6)  NOT NULL,
      currency          NVARCHAR(3)    NULL,
      mode              NVARCHAR(10)   NOT NULL,
      status            NVARCHAR(20)   NOT NULL CONSTRAINT price_update_line_status_df DEFAULT N'pending',
      error             NVARCHAR(500)  NULL,
      applied_at        DATETIME2      NULL,
      CONSTRAINT CK_price_update_line_mode CHECK (mode IN (N'list', N'special')),
      CONSTRAINT CK_price_update_line_status CHECK (status IN (N'pending', N'applied', N'error'))
    );
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'price_update_line_update_idx')
    CREATE NONCLUSTERED INDEX price_update_line_update_idx ON dbo.price_update_line(id_price_update);
  -- Each company's "price list update" workflow process.
  IF COL_LENGTH(N'dbo.sales_company_config', N'id_process_category_price_list') IS NULL
    ALTER TABLE dbo.sales_company_config ADD id_process_category_price_list INT NULL;
COMMIT TRANSACTION;
SELECT OBJECT_ID(N'dbo.price_update', N'U') AS t1, OBJECT_ID(N'dbo.price_update_line', N'U') AS t2, COL_LENGTH(N'dbo.sales_company_config', N'id_process_category_price_list') AS col;
