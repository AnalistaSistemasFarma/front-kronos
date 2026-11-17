/*
  REVERSA — Auditoría de agentes → Costos y licencias (2026-11-17). Borra las tablas nuevas y las columnas
  token_fp/org_fp de chat_agent_quota. PIERDE el inventario de licencias y el historial del cupo:
  respaldar antes si hace falta. Vale para PRUEBAS y PROD.
*/
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000; SET XACT_ABORT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB')
  THROW 51703, N'Base no esperada para este script.', 1;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[chat_agent_quota_history]', N'U') IS NOT NULL DROP TABLE [dbo].[chat_agent_quota_history];
IF OBJECT_ID(N'[dbo].[ai_license_agent]', N'U') IS NOT NULL DROP TABLE [dbo].[ai_license_agent];
IF OBJECT_ID(N'[dbo].[ai_license_token]', N'U') IS NOT NULL DROP TABLE [dbo].[ai_license_token];
IF OBJECT_ID(N'[dbo].[ai_license]', N'U') IS NOT NULL DROP TABLE [dbo].[ai_license];
IF COL_LENGTH(N'dbo.chat_agent_quota', N'token_fp') IS NOT NULL ALTER TABLE [dbo].[chat_agent_quota] DROP COLUMN [token_fp];
IF COL_LENGTH(N'dbo.chat_agent_quota', N'org_fp') IS NOT NULL ALTER TABLE [dbo].[chat_agent_quota] DROP COLUMN [org_fp];
COMMIT;
END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH;
