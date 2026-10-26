/*
  REVERSA — Compras: mapeo SAPSEND por empresa. Deshace
  prisma/manual/2026-10-20-compras-mapeo-sapsend-PRUEBAS.sql / -PROD.sql: quita el subproceso
  /process/purchases/manage con sus asignaciones y las dos columnas de company_user CON SUS DATOS.

  PÉRDIDA DE DATOS: si ya se cargó el mapeo, respalde antes:
      SELECT id_company_user, id_user_sapsend, id_department_sapsend FROM dbo.company_user
      WHERE id_user_sapsend IS NOT NULL OR id_department_sapsend IS NOT NULL;
  El script se DETIENE si hay datos, salvo que la sesión declare que acepta perderlos:
      EXEC sp_set_session_context N'compras_mapeo_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51464, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF COL_LENGTH(N'dbo.company_user', N'id_user_sapsend') IS NOT NULL
  AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'compras_mapeo_reversa_acepta_perdida')), 0) <> 1
  AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.company_user') AND name = N'id_user_sapsend')
BEGIN
  DECLARE @hay INT;
  EXEC sp_executesql
    N'SELECT @n = COUNT(*) FROM dbo.company_user WHERE id_user_sapsend IS NOT NULL OR id_department_sapsend IS NOT NULL',
    N'@n INT OUTPUT', @n = @hay OUTPUT;
  IF @hay > 0
    THROW 51465, N'Hay mapeos SAPSEND cargados. Respáldelos y declare compras_mapeo_reversa_acepta_perdida = 1.', 1;
END

DECLARE @SubUrl NVARCHAR(255) = N'/process/purchases/manage';

BEGIN TRANSACTION;
  DELETE suc FROM [dbo].[subprocess_user_company] suc
  JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
  WHERE s.subprocess_url = @SubUrl;
  DELETE FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl;
  IF COL_LENGTH(N'dbo.company_user', N'id_department_sapsend') IS NOT NULL
    ALTER TABLE [dbo].[company_user] DROP COLUMN [id_department_sapsend];
  IF COL_LENGTH(N'dbo.company_user', N'id_user_sapsend') IS NOT NULL
    ALTER TABLE [dbo].[company_user] DROP COLUMN [id_user_sapsend];
COMMIT TRANSACTION;
PRINT N'Reversa del mapeo SAPSEND de compras aplicada.';
