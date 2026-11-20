/*
  REVERSA — Vulnerabilidades (OSV). Deshace prisma/manual/2026-11-19-vulnerabilidades-*.sql: borra
  dbo.agent_vuln_finding y dbo.agent_vuln_run CON SUS FILAS. Los datos se regeneran con un escaneo nuevo,
  salvo las revisiones (estado/nota): si hay revisiones, el script se DETIENE salvo que la sesión lo acepte:
      EXEC sp_set_session_context N'vulnerabilidades_reversa_acepta_perdida', 1;
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51623, N'Base no esperada.', 1;
IF OBJECT_ID(N'dbo.agent_vuln_finding', N'U') IS NOT NULL
  AND EXISTS (SELECT 1 FROM dbo.agent_vuln_finding WHERE estado <> N'nuevo')
  AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'vulnerabilidades_reversa_acepta_perdida')), 0) <> 1
  THROW 51624, N'Hay hallazgos revisados. Exporte y declare vulnerabilidades_reversa_acepta_perdida = 1.', 1;
BEGIN TRY
BEGIN TRAN;
IF OBJECT_ID(N'dbo.agent_vuln_finding', N'U') IS NOT NULL DROP TABLE dbo.agent_vuln_finding;
IF OBJECT_ID(N'dbo.agent_vuln_run', N'U') IS NOT NULL DROP TABLE dbo.agent_vuln_run;
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
