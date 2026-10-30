/* REVERSA — Copias de seguridad de los agentes (2026-10-30). Primero el código anterior. Pérdida: el historial recolectado (se reconstruye de los registros de 14 días de cada Mac). */
SET XACT_ABORT ON; SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51603, N'Base no esperada.', 1;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'dbo.agent_backup_check', N'U') IS NOT NULL DROP TABLE [dbo].[agent_backup_check];
IF OBJECT_ID(N'dbo.agent_backup_host', N'U') IS NOT NULL DROP TABLE [dbo].[agent_backup_host];
IF OBJECT_ID(N'dbo.agent_backup_run', N'U') IS NOT NULL DROP TABLE [dbo].[agent_backup_run];
COMMIT TRAN; END TRY BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK TRAN; THROW; END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_backup_run', N'U') AS agent_backup_run;
