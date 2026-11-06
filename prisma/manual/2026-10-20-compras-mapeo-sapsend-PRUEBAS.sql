/*
  PASE MANUAL (PRUEBAS) — Compras: mapeo de usuario y departamento SAPSEND por empresa. 2026-10-20.
  BASE: KRONOSDB_PRUEBAS o kronos_ci (el script se detiene en cualquier otra base).

  POR QUÉ: cada SAPSEND (Farmalógica, OLP, Ryan, ...) tiene su propia base, así que el ID de
  perfil y el de departamento cambian por empresa. Se guardan en company_user (usuario × empresa).
  Lo usa SOLO el módulo de compras (lib/purchases/requester.ts). User.id_user_sapsend no se toca.

  QUÉ HACE (idempotente; solo agrega, no borra ni modifica datos existentes):
    1. Columnas NULL company_user.id_user_sapsend y company_user.id_department_sapsend.
    2. Subproceso-permiso /process/purchases/manage «Compras · Gestionar solicitudes» en el MISMO
       proceso que /process/purchases (no lo otorga a nadie: se asigna desde Administración → Usuarios).

  CARGA DE DATOS: aparte, desde profiles de cada SAPSEND cruzando por correo (no incluida aquí).
  REVERSA: prisma/manual/2026-10-20-compras-mapeo-sapsend-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51460, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @ReadUrl  NVARCHAR(255) = N'/process/purchases';
DECLARE @SubUrl   NVARCHAR(255) = N'/process/purchases/manage';
DECLARE @SubName  NVARCHAR(255) = N'Compras · Gestionar solicitudes';

DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[subprocess]
  WHERE LOWER(LTRIM(RTRIM(subprocess_url))) = @ReadUrl ORDER BY id_subprocess
);
IF @ProcessId IS NULL
  THROW 51461, N'No existe el subproceso /process/purchases: revise la base antes de seguir.', 1;

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
