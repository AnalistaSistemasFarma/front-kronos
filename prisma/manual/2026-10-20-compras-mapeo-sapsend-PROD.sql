/*
  PASE MANUAL (PROD) — Compras: mapeo de usuario y departamento SAPSEND por empresa. 2026-10-20.
  BASE: KRONOSDB (el script se detiene en cualquier otra base).

  Igual a prisma/manual/2026-10-20-compras-mapeo-sapsend-PRUEBAS.sql (ver allí el detalle).
  Idempotente; solo agrega columnas NULL en company_user y el subproceso /process/purchases/manage
  (sin otorgarlo a nadie). Lo usa SOLO el módulo de compras.

  ANTES: respaldo COPY_ONLY de la base. SOLO en la ventana autorizada del pase, después de validarlo en PRUEBAS.
  REVERSA: prisma/manual/2026-10-20-compras-mapeo-sapsend-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51462, N'Base no esperada: este script es solo para KRONOSDB.', 1;

DECLARE @ReadUrl  NVARCHAR(255) = N'/process/purchases';
DECLARE @SubUrl   NVARCHAR(255) = N'/process/purchases/manage';
DECLARE @SubName  NVARCHAR(255) = N'Compras · Gestionar solicitudes';

DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[subprocess]
  WHERE LOWER(LTRIM(RTRIM(subprocess_url))) = @ReadUrl ORDER BY id_subprocess
);
IF @ProcessId IS NULL
  THROW 51463, N'No existe el subproceso /process/purchases: revise la base antes de seguir.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF COL_LENGTH(N'dbo.company_user', N'id_user_sapsend') IS NULL
    ALTER TABLE [dbo].[company_user] ADD [id_user_sapsend] INT NULL;
  IF COL_LENGTH(N'dbo.company_user', N'id_department_sapsend') IS NULL
    ALTER TABLE [dbo].[company_user] ADD [id_department_sapsend] INT NULL;

  IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl)
    INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (@SubName, @ProcessId, @SubUrl);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Diagnóstico */
SELECT DB_NAME() AS base,
       COL_LENGTH(N'dbo.company_user', N'id_user_sapsend') AS col_user,
       COL_LENGTH(N'dbo.company_user', N'id_department_sapsend') AS col_dep,
       (SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl) AS id_subproceso;
