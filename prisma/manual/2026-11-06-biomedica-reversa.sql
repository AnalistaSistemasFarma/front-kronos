/*
  REVERSA — Ingeniería biomédica (2026-11-06). Deshace prisma/migrations/20261106150000_biomedica y los
  scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): quita las tablas biomed_* y el permiso (con sus asignaciones). Si hay formatos
  diligenciados o trazabilidad, se niega salvo con la bandera de sesión:
    EXEC sp_set_session_context N'biomedica_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51594, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @registros INT = 0;
DECLARE @eventos INT = 0;
IF OBJECT_ID(N'dbo.biomed_registro', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[biomed_registro]', N'@n INT OUTPUT', @n = @registros OUTPUT;
IF OBJECT_ID(N'dbo.biomed_evento', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[biomed_evento]', N'@n INT OUTPUT', @n = @eventos OUTPUT;
SELECT DB_NAME() AS base, 'antes' AS momento, @registros AS registros, @eventos AS eventos;

IF (@registros > 0 OR @eventos > 0)
   AND ISNULL(CAST(SESSION_CONTEXT(N'biomedica_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51595, N'Hay formatos diligenciados o trazabilidad: use la bandera biomedica_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.biomed_evento_solo_insercion', N'TR') IS NOT NULL DROP TRIGGER [dbo].[biomed_evento_solo_insercion];
  IF OBJECT_ID(N'dbo.biomed_evento', N'U') IS NOT NULL DROP TABLE [dbo].[biomed_evento];
  IF OBJECT_ID(N'dbo.biomed_registro', N'U') IS NOT NULL DROP TABLE [dbo].[biomed_registro];
  IF OBJECT_ID(N'dbo.biomed_formato', N'U') IS NOT NULL DROP TABLE [dbo].[biomed_formato];
  DELETE suc FROM [dbo].[subprocess_user_company] suc JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess WHERE s.subprocess_url = N'/process/sgc-documental/biomedica';
  DELETE FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/sgc-documental/biomedica';
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, OBJECT_ID(N'dbo.biomed_registro', N'U') AS biomed_registro,
       (SELECT COUNT(*) FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/sgc-documental/biomedica') AS permiso;
