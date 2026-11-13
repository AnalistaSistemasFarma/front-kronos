/*
  REVERSA — Permisos API: vencimiento de llaves. 2026-11-10.
  Sirve para KRONOSDB_PRUEBAS o KRONOSDB. Quita la columna expires_at: las llaves que tenían
  fecha pasan a NO vencer. OJO: el código del 2026-11-10 EXIGE la columna; sin ella niega todas las llaves de la base. Revertir solo junto con el código.
  ANTES: respaldo COPY_ONLY.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB')
  THROW 51484, N'Base no esperada.', 1;

IF COL_LENGTH(N'dbo.api_client_key', N'expires_at') IS NOT NULL
  ALTER TABLE [dbo].[api_client_key] DROP COLUMN [expires_at];

SELECT DB_NAME() AS base, COL_LENGTH(N'dbo.api_client_key', N'expires_at') AS expires_at_bytes;
