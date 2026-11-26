/*
  REVERSA — Auditoría de agentes → Adopción de IA vs plantilla (2026-11-26). Borra dbo.ai_headcount_snapshot:
  PIERDE las fotos semanales de Microsoft 365 y Talento Humano (respaldar antes con SELECT * INTO). Vale para PRUEBAS y PROD.
  La página sigue funcionando sin la tabla (solo muestra el valor del día).
*/
SET NOCOUNT ON; SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB') THROW 51763, N'Base no esperada para este script.', 1;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[ai_headcount_snapshot]', N'U') IS NOT NULL DROP TABLE [dbo].[ai_headcount_snapshot];
IF OBJECT_ID(N'[dbo].[ai_headcount_snapshot]', N'U') IS NOT NULL
BEGIN
  ROLLBACK;
  THROW 51764, N'Validación fallida: la tabla sigue existiendo.', 1;
END;
COMMIT;
END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH;
