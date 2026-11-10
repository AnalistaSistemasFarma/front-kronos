/*
  REVERSA — Análisis de seguridad de conversaciones. Deshace prisma/manual/2026-11-05-analisis-seguridad-*.sql.
  Borra dbo.agent_security_finding y dbo.agent_security_run CON SUS FILAS.

  PÉRDIDA DE DATOS: los hallazgos son evidencia de seguridad. Si hay hallazgos, el script se DETIENE
  salvo que la sesión declare que acepta perderlos:
      EXEC sp_set_session_context N'analisis_seguridad_reversa_acepta_perdida', 1;
  Antes, exporte los hallazgos (botón Exportar de la pantalla) o respalde las tablas.
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51603, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF OBJECT_ID(N'dbo.agent_security_finding', N'U') IS NOT NULL
  AND EXISTS (SELECT 1 FROM dbo.agent_security_finding)
  AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'analisis_seguridad_reversa_acepta_perdida')), 0) <> 1
  THROW 51604, N'Hay hallazgos registrados. Respáldelos y declare analisis_seguridad_reversa_acepta_perdida = 1.', 1;

BEGIN TRY
BEGIN TRAN;
IF OBJECT_ID(N'dbo.agent_security_finding', N'U') IS NOT NULL DROP TABLE dbo.agent_security_finding;
IF OBJECT_ID(N'dbo.agent_security_run', N'U') IS NOT NULL DROP TABLE dbo.agent_security_run;
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
