/*
  REVERSA — Vulnerabilidades → «Lo más reciente y crítico». Deshace prisma/manual/2026-11-20-vulnerabilidades-criticas-*.sql:
  borra dbo.agent_threat_sync, dbo.agent_threat_cve y dbo.agent_threat_inventory CON SUS FILAS.
  El catálogo de CVE se regenera solo (KEV + NVD). El INVENTARIO NO: si tiene filas editadas por personas
  (updated_by no nulo), el script se DETIENE salvo que la sesión lo acepte (exporte antes la pestaña):
      EXEC sp_set_session_context N'vulnerabilidades_criticas_reversa_acepta_perdida', 1;
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente. El código sigue funcionando sin las
  tablas (la pestaña dice «aún no habilitada»), así que el orden con el código da igual.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51643, N'Base no esperada.', 1;
IF OBJECT_ID(N'dbo.agent_threat_inventory', N'U') IS NOT NULL
  AND EXISTS (SELECT 1 FROM dbo.agent_threat_inventory WHERE updated_by IS NOT NULL)
  AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'vulnerabilidades_criticas_reversa_acepta_perdida')), 0) <> 1
  THROW 51644, N'Hay filas del inventario editadas por personas. Exporte y declare vulnerabilidades_criticas_reversa_acepta_perdida = 1.', 1;
BEGIN TRY
BEGIN TRAN;
IF OBJECT_ID(N'dbo.agent_threat_inventory', N'U') IS NOT NULL DROP TABLE dbo.agent_threat_inventory;
IF OBJECT_ID(N'dbo.agent_threat_cve', N'U') IS NOT NULL DROP TABLE dbo.agent_threat_cve;
IF OBJECT_ID(N'dbo.agent_threat_sync', N'U') IS NOT NULL DROP TABLE dbo.agent_threat_sync;
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_threat_inventory', N'U') AS inventario_queda, OBJECT_ID(N'dbo.agent_threat_cve', N'U') AS cve_queda;
