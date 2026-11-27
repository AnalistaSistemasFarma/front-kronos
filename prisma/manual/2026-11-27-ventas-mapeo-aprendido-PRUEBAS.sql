/*
  Ventas - learned item mappings of the PDF offer review (SynerLink msg 41435, 2026-11-27).
  Tables:
    dbo.sales_item_mapping_learned      one row per company + customer + PO key (reference, EAN or description)
    dbo.sales_item_mapping_learned_log  audit: who taught or forgot what, and when (user or agent)

  - Checks the database before any change (@expected_db).
  - Idempotent: creates each table only if it does not exist.
  - One batch, one transaction, XACT_ABORT + LOCK_TIMEOUT 5000: COMMIT only if both tables exist
    afterwards, otherwise ROLLBACK + THROW. Never leaves a transaction open.
  - Only new tables: no lock on existing tables, no data change.

  PRUEBAS: KRONOSDB_PRUEBAS. PRODUCTION: use the -PROD file (same script, @expected_db = KRONOSDB).
  Rollback: 2026-11-27-ventas-mapeo-aprendido-reversa.sql
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

DECLARE @expected_db sysname = N'KRONOSDB_PRUEBAS';
DECLARE @current_db sysname = DB_NAME();
IF @current_db <> @expected_db
BEGIN
  RAISERROR(N'Wrong database: %s (expected %s). Nothing was changed.', 16, 1, @current_db, @expected_db);
  RETURN;
END;

SELECT N'BEFORE' AS moment,
       OBJECT_ID(N'dbo.sales_item_mapping_learned', N'U') AS mapping_table,
       OBJECT_ID(N'dbo.sales_item_mapping_learned_log', N'U') AS log_table;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.sales_item_mapping_learned', N'U') IS NULL
  BEGIN
    EXEC (N'
      CREATE TABLE dbo.sales_item_mapping_learned (
        id            int IDENTITY(1,1) NOT NULL CONSTRAINT PK_sales_item_mapping_learned PRIMARY KEY,
        id_company    int            NOT NULL,
        card_code     nvarchar(50)   NOT NULL,
        key_type      nvarchar(10)   NOT NULL CONSTRAINT CK_sales_item_mapping_learned_key_type CHECK (key_type IN (N''cliente'', N''ean'', N''desc'')),
        key_value     nvarchar(300)  NOT NULL,
        item_code     nvarchar(50)   NOT NULL,
        item_name     nvarchar(200)  NULL,
        factor        decimal(18,4)  NOT NULL CONSTRAINT DF_sales_item_mapping_learned_factor DEFAULT (1) CONSTRAINT CK_sales_item_mapping_learned_factor CHECK (factor > 0),
        description   nvarchar(500)  NULL,
        active        bit            NOT NULL CONSTRAINT DF_sales_item_mapping_learned_active DEFAULT (1),
        times_taught  int            NOT NULL CONSTRAINT DF_sales_item_mapping_learned_times DEFAULT (1),
        created_by    nvarchar(320)  NOT NULL,
        created_at    datetime2(0)   NOT NULL CONSTRAINT DF_sales_item_mapping_learned_created DEFAULT SYSUTCDATETIME(),
        updated_at    datetime2(0)   NOT NULL CONSTRAINT DF_sales_item_mapping_learned_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_sales_item_mapping_learned_key UNIQUE (id_company, card_code, key_type, key_value)
      );');
  END;

  IF OBJECT_ID(N'dbo.sales_item_mapping_learned_log', N'U') IS NULL
  BEGIN
    EXEC (N'
      CREATE TABLE dbo.sales_item_mapping_learned_log (
        id           bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_sales_item_mapping_learned_log PRIMARY KEY,
        id_company   int            NOT NULL,
        card_code    nvarchar(50)   NOT NULL,
        key_type     nvarchar(10)   NOT NULL,
        key_value    nvarchar(300)  NOT NULL,
        item_code    nvarchar(50)   NULL,
        factor       decimal(18,4)  NULL,
        action       nvarchar(10)   NOT NULL CONSTRAINT CK_sales_item_mapping_learned_log_action CHECK (action IN (N''save'', N''forget'')),
        source       nvarchar(10)   NOT NULL CONSTRAINT CK_sales_item_mapping_learned_log_source CHECK (source IN (N''usuario'', N''agente'')),
        user_email   nvarchar(320)  NOT NULL,
        created_at   datetime2(0)   NOT NULL CONSTRAINT DF_sales_item_mapping_learned_log_created DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_sales_item_mapping_learned_log_customer ON dbo.sales_item_mapping_learned_log (id_company, card_code, created_at);');
  END;

  IF OBJECT_ID(N'dbo.sales_item_mapping_learned', N'U') IS NULL OR OBJECT_ID(N'dbo.sales_item_mapping_learned_log', N'U') IS NULL
  BEGIN
    ROLLBACK TRAN;
    THROW 50001, N'Validation failed: the learned mapping tables were not created. Rolled back.', 1;
  END;

  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT N'AFTER' AS moment, OBJECT_NAME(c.object_id) AS table_name, c.name AS column_name, t.name AS data_type
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id IN (OBJECT_ID(N'dbo.sales_item_mapping_learned'), OBJECT_ID(N'dbo.sales_item_mapping_learned_log'))
ORDER BY c.object_id, c.column_id;
