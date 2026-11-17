/*
  REVERSA — Auditoría de agentes → Facturas de IA (2026-11-17). Borra las 3 tablas: PIERDE las facturas cargadas
  y sus PDF (respaldar antes con SELECT * INTO). Vale para PRUEBAS y PROD.
*/
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000; SET XACT_ABORT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB') THROW 51723, N'Base no esperada para este script.', 1;
BEGIN TRY BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[ai_invoice_split]', N'U') IS NOT NULL DROP TABLE [dbo].[ai_invoice_split];
IF OBJECT_ID(N'[dbo].[ai_invoice_line]', N'U') IS NOT NULL DROP TABLE [dbo].[ai_invoice_line];
IF OBJECT_ID(N'[dbo].[ai_invoice]', N'U') IS NOT NULL DROP TABLE [dbo].[ai_invoice];
COMMIT;
END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH;
