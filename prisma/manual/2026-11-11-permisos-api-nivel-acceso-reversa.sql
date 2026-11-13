/*
  REVERSA — Permisos API: nivel de acceso. 2026-11-11.
  Sirve para KRONOSDB_PRUEBAS o KRONOSDB. Quita api_client.access_mode y api_permission.access_kind
  con sus CHECK y DEFAULT. OJO: el código del 2026-11-11 EXIGE las columnas; sin ellas el panel falla y
  el MCP no carga las llaves de la base. Revertir solo junto con el código. ANTES: respaldo COPY_ONLY.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB')
  THROW 51776, N'Base no esperada.', 1;

BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'api_client_access_mode_ck' AND parent_object_id = OBJECT_ID(N'dbo.api_client'))
  ALTER TABLE [dbo].[api_client] DROP CONSTRAINT [api_client_access_mode_ck];
IF COL_LENGTH(N'dbo.api_client', N'access_mode') IS NOT NULL
  ALTER TABLE [dbo].[api_client] DROP COLUMN [access_mode];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'api_permission_access_kind_ck' AND parent_object_id = OBJECT_ID(N'dbo.api_permission'))
  ALTER TABLE [dbo].[api_permission] DROP CONSTRAINT [api_permission_access_kind_ck];
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'api_permission_access_kind_df' AND parent_object_id = OBJECT_ID(N'dbo.api_permission'))
  ALTER TABLE [dbo].[api_permission] DROP CONSTRAINT [api_permission_access_kind_df];
IF COL_LENGTH(N'dbo.api_permission', N'access_kind') IS NOT NULL
  ALTER TABLE [dbo].[api_permission] DROP COLUMN [access_kind];

COMMIT TRANSACTION;

SELECT DB_NAME() AS base,
       COL_LENGTH(N'dbo.api_client', N'access_mode') AS access_mode_bytes,
       COL_LENGTH(N'dbo.api_permission', N'access_kind') AS access_kind_bytes;
